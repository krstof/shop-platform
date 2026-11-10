// Registriert alle Endpunkte aus den Modulen bei Fastify (ADR-009). Jede Anfrage läuft durch
// dieselbe Kette, kein Endpunkt kann einen Schritt überspringen:
//
//   0. Herkunftsprüfung (CSRF, Q-14, Sicherheit 5.5): ändernde Anfragen von fremden Seiten ergeben 403.
//   1. Anmeldung und Berechtigung (globaler Wächter, Q-03): ohne Akteur 401, ohne Scope 403.
//      Die Prüfung kommt vor der Eingabeprüfung, damit Unangemeldete nichts über Schemas erfahren.
//   2. Strenge Prüfung von Pfad, Abfrage und Inhalt mit Zod (Q-02): Fehler ergeben 422.
//      Kopfzeilen (If-Match, Idempotency-Key, Shop-Id) mit falschem Format ergeben 400.
//   3. Ausführung im Anfrage-Kontext des Kernels (requestId, Mandant, Akteur), sodass
//      withTenantTransaction den Shop kennt, ohne dass ein Endpunkt ihn weiterreichen muss.
//   4. Ausgabe durch das Antwort-Schema: Felder, die dort nicht stehen, gehen nie hinaus.
import type { AuthenticatedActor, ClientInfo, Endpoint } from "@shop/http";
import {
  BadRequestError,
  CrossOriginRejectedError,
  ForbiddenError,
  MethodNotAllowedError,
  NotFoundError,
  IDEMPOTENCY_KEY_PATTERN,
  PreconditionRequiredError,
  RateLimitedError,
  requestFingerprint,
  type IdempotencyRequest,
  isUuid,
  pickLocale,
  runWithContext,
  UnauthorizedError,
  ValidationError,
  validationErrorFromZod,
  zodErrorMap,
  type Locale,
  type Logger,
} from "@shop/kernel";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SHOP_ID_HEADER, type ActorResolver } from "./actor.js";
import type { IdempotencyStore } from "./idempotency-store.js";
import { clientNetwork, type RateLimiter } from "./rate-limit.js";
import { sendProblem } from "./problem-reply.js";

const NO_QUERY = z.strictObject({});
const NO_PARAMS = z.strictObject({});

const BODY_NOT_ALLOWED: Readonly<Record<Locale, string>> = {
  de: "Dieser Endpunkt erwartet keinen Inhalt.",
  en: "This endpoint does not accept a body.",
};

export interface RouterOptions {
  readonly endpoints: readonly Endpoint[];
  readonly resolveActor: ActorResolver;
  readonly logger: Logger;
  readonly idempotency: IdempotencyStore;
  /** Ohne Bremse nur in Tests, die sie nicht prüfen. */
  readonly rateLimiter?: RateLimiter | undefined;
  /** Oberflächen, die ändernde Anfragen schicken dürfen. Leer: jede Anfrage mit `Origin` wird abgelehnt. */
  readonly allowedOrigins?: readonly string[] | undefined;
  /**
   * Storefront-API (M4): Shop zum Kürzel im Pfad (`/store/v1/shops/{shopHandle}/…`). Nur aktive
   * Shops; unbekannt oder gesperrt ergibt 404. Ohne Angabe kennt die Storefront-API keinen Shop.
   */
  readonly storeShops?: StoreShopResolver | undefined;
}

/** Kennung eines aktiven Shops zum Kürzel, sonst `undefined`. */
export type StoreShopResolver = (handle: string) => Promise<string | undefined>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Herkunftsprüfung gegen untergeschobene Anfragen (CSRF, Sicherheit 5.5, B-11, T-11).
 * Browser schicken bei ändernden Anfragen immer `Origin`; die muss in der Liste stehen
 * (auch „null“ von Sandbox-Seiten oder Weiterleitungen fällt durch). Ältere Browser ohne `Origin`
 * schicken oft `Sec-Fetch-Site`: nur „same-origin“ und „none“ (vom Nutzer selbst ausgelöst) gehen.
 * Ohne beide Kopfzeilen fragt kein Browser an (Skripte, Apps mit API-Token): Dann gibt es nichts
 * unterzuschieben, weil kein Browser ungefragt Cookies mitsendet.
 */
export function isAllowedOrigin(
  method: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const origin = headers["origin"];
  if (origin !== undefined) return typeof origin === "string" && allowedOrigins.has(origin);
  const site = headers["sec-fetch-site"];
  if (site !== undefined) return site === "same-origin" || site === "none";
  return true;
}

/** Pfad aus OpenAPI-Form (`{id}`) in Fastify-Form (`:id`). */
export function toFastifyPath(fullPath: string): string {
  return fullPath.replace(/\{([a-zA-Z0-9]+)\}/g, ":$1");
}

/** Prüft die Liste als Ganzes: operationId und Methode plus Pfad müssen eindeutig sein. */
export function assertUniqueEndpoints(endpoints: readonly Endpoint[]): void {
  const ids = new Set<string>();
  const routes = new Set<string>();
  const problems: string[] = [];
  for (const e of endpoints) {
    if (ids.has(e.operationId)) problems.push(`operationId doppelt: ${e.operationId}`);
    ids.add(e.operationId);
    const route = `${e.method} ${toFastifyPath(e.fullPath).replace(/:[a-zA-Z0-9]+/g, ":")}`;
    if (routes.has(route)) problems.push(`Route doppelt: ${e.method} ${e.fullPath}`);
    routes.add(route);
  }
  if (problems.length > 0) throw new Error(`Endpunkte sind nicht eindeutig:\n  - ${problems.join("\n  - ")}`);
}

function parse<S extends z.ZodType>(schema: S, value: unknown, prefix: string, locale: Locale): z.output<S> {
  const result = schema.safeParse(value ?? {}, { error: zodErrorMap(locale) });
  if (!result.success) throw validationErrorFromZod(result.error, locale, prefix);
  return result.data;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sucht Zeichen, die PostgreSQL in Text nicht speichern kann (NUL) oder die nie gültig sind (einzelne Ersatzzeichen). */
export function findUnsafeStrings(value: unknown, path = ""): string[] {
  // eslint-disable-next-line no-control-regex -- genau dieses Steuerzeichen soll gefunden werden
  if (typeof value === "string") return /\u0000|\p{Cs}/u.test(value) ? [path || "/"] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findUnsafeStrings(v, `${path}/${i}`));
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [
      ...findUnsafeStrings(k, `${path}/${k}`),
      ...findUnsafeStrings(v, `${path}/${k}`),
    ]);
  return [];
}

const UNSAFE_TEXT: Readonly<Record<Locale, string>> = {
  de: "Der Text enthält ein unzulässiges Steuerzeichen.",
  en: "The text contains a forbidden control character.",
};

function rejectUnsafe(value: unknown, prefix: string, locale: Locale): void {
  const found = [...new Set(findUnsafeStrings(value))];
  if (found.length === 0) return;
  throw new ValidationError({
    detail: UNSAFE_TEXT[locale],
    errors: found.map((p) => ({
      path: prefix + (p === "/" ? "" : p),
      code: "invalid_characters",
      message: UNSAFE_TEXT[locale],
    })),
  });
}

export function registerEndpoints(fastify: FastifyInstance, options: RouterOptions): void {
  assertUniqueEndpoints(options.endpoints);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  // Bekannte Adresse, aber falsche Methode: 405 mit Allow, statt 404 oder 500 (gefunden von Schemathesis).
  const byPath = new Map<string, Set<string>>();
  for (const e of options.endpoints) {
    const path = toFastifyPath(e.fullPath);
    const methods = byPath.get(path) ?? new Set<string>();
    methods.add(e.method);
    if (e.method === "GET") methods.add("HEAD");
    byPath.set(path, methods);
  }
  for (const [path, methods] of byPath) {
    const others = fastify.supportedMethods.filter((m) => !methods.has(m));
    if (others.length === 0) continue;
    const allow = [...methods].sort().join(", ");
    const notAllowed = (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("allow", allow);
      return sendProblem(
        reply,
        new MethodNotAllowedError(),
        request.id,
        pickLocale(request.headers["accept-language"]),
        options.logger,
      );
    };
    fastify.route({
      method: others,
      url: path,
      // Auch wenn der Inhalt schon nicht lesbar ist: Die Methode ist der eigentliche Fehler.
      errorHandler: (_error, request, reply) => notAllowed(request, reply),
      handler: notAllowed,
    });
  }
  for (const endpoint of options.endpoints) {
    fastify.route({
      method: endpoint.method,
      url: toFastifyPath(endpoint.fullPath),
      ...(endpoint.bodyLimit === undefined ? {} : { bodyLimit: endpoint.bodyLimit }),
      // Fehler aus Fastify selbst (Größe, Datenformat, kaputtes JSON) ebenfalls als Problem Details.
      errorHandler: (error, request, reply) =>
        sendProblem(reply, error, request.id, pickLocale(request.headers["accept-language"]), options.logger),
      handler: (request, reply) => handle(endpoint, request, reply, options, allowedOrigins),
    });
  }
}

interface RequestState {
  readonly endpoint: Endpoint;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly options: RouterOptions;
  readonly locale: Locale;
}

const IF_MATCH = /^"(\d{1,9})"$/;

/** Version aus `If-Match` (nur starke ETags in der Form "3"). */
function readIfMatch({ endpoint, request, locale }: RequestState): number | undefined {
  const raw = headerValue(request.headers["if-match"]);
  if (endpoint.ifMatch !== "required") return undefined;
  if (raw === undefined) throw new PreconditionRequiredError();
  const m = IF_MATCH.exec(raw.trim());
  if (m?.[1] === undefined) {
    throw new BadRequestError({
      detail: IF_MATCH_INVALID[locale],
      errors: [{ path: "/headers/if-match", code: "invalid_format", message: IF_MATCH_INVALID[locale] }],
    });
  }
  return Number(m[1]);
}

/**
 * Kopfzeile Shop-Id der Admin-API (E6 Teil 3): Wenn sie kommt, dann genau einmal und als UUID.
 * Welcher Shop gilt, entscheidet allein die Auflösung des Akteurs (actor.ts) anhand der
 * Mitgliedschaft; mit Sitzung führt eine kaputte Shop-Id dort schon zu 403. Diese Prüfung sorgt
 * dafür, dass eine kaputte Angabe nie still übergangen wird (etwa bei API-Token, die ihren Shop
 * selbst mitbringen).
 */
function checkShopIdHeader({ request, locale }: RequestState): void {
  const raw = request.headers[SHOP_ID_HEADER];
  if (raw === undefined) return;
  if (typeof raw === "string" && isUuid(raw.trim().toLowerCase())) return;
  throw new BadRequestError({
    detail: SHOP_ID_INVALID[locale],
    errors: [{ path: "/headers/shop-id", code: "invalid_format", message: SHOP_ID_INVALID[locale] }],
  });
}

const SHOP_ID_INVALID: Readonly<Record<Locale, string>> = {
  de: "Shop-Id muss genau einmal und als UUID angegeben werden.",
  en: "Shop-Id must be given exactly once, as a UUID.",
};

/** Bremse nach der Anmeldung: je Akteur (Token oder Sitzung), sonst je Netz. */
function limitActor(
  { endpoint, request, reply, options }: RequestState,
  auth: AuthenticatedActor | undefined,
): void {
  if (options.rateLimiter === undefined) return;
  const byActor = endpoint.rateLimit === "admin" || endpoint.rateLimit === "platform";
  const key =
    byActor && auth !== undefined
      ? `${auth.actor.type}:${auth.actor.id ?? "-"}`
      : `${clientNetwork(request.ip)}|${auth?.tenantId ?? "-"}`;
  const r = options.rateLimiter.take(endpoint.rateLimit, key);
  if (!r.allowed) {
    reply.header("retry-after", String(r.retryAfterSeconds));
    throw new RateLimitedError();
  }
}

function sendJson(reply: FastifyReply, status: number, data: unknown): FastifyReply {
  const version = (data as { version?: unknown } | null)?.version;
  if (Number.isInteger(version)) reply.header("etag", `"${String(version)}"`);
  return reply
    .code(status)
    .header("content-type", "application/json; charset=utf-8")
    .header("cache-control", "no-store")
    .send(JSON.stringify(data));
}

const SET_COOKIE_NOT_ALLOWED = "setCookie gibt es nur in der Auth-API";

async function handle(
  endpoint: Endpoint,
  request: FastifyRequest,
  reply: FastifyReply,
  options: RouterOptions,
  allowedOrigins: ReadonlySet<string>,
): Promise<FastifyReply> {
  const requestId = request.id;
  const locale = pickLocale(request.headers["accept-language"]);
  const state: RequestState = { endpoint, request, reply, options, locale };
  // Cookies setzt nur die Auth-API; sie gehen auch mit einer Fehlerantwort hinaus.
  const cookies: string[] = [];
  const isAuthApi = endpoint.api === "auth";
  const setCookie = (line: string): void => {
    if (!isAuthApi) throw new Error(SET_COOKIE_NOT_ALLOWED);
    cookies.push(line);
  };
  const flushCookies = (): void => {
    if (cookies.length > 0) reply.header("set-cookie", cookies);
  };
  const client: ClientInfo | undefined = isAuthApi
    ? {
        ip: request.ip,
        userAgent: headerValue(request.headers["user-agent"]),
        cookie: headerValue(request.headers["cookie"]),
      }
    : undefined;
  try {
    // 0. Herkunft (vor allem anderen, auch vor der Anmeldung)
    if (!isAllowedOrigin(request.method, request.headers, allowedOrigins))
      throw new CrossOriginRejectedError();

    // 1. Anmeldung, Berechtigung und Bremse je Akteur
    let auth: AuthenticatedActor | undefined;
    if ("signedIn" in endpoint.access) {
      auth = await options.resolveActor({ headers: request.headers });
      if (auth === undefined) throw new UnauthorizedError();
    }
    if ("scopes" in endpoint.access) {
      auth = await options.resolveActor({ headers: request.headers });
      if (auth === undefined) throw new UnauthorizedError();
      const missing = endpoint.access.scopes.filter((s) => !auth?.scopes.has(s));
      if (missing.length > 0) throw new ForbiddenError();
      // Die Admin-API arbeitet immer für genau einen Shop, die Platform-API für keinen.
      if (endpoint.api === "admin" && (auth.tenantId === undefined || !isUuid(auth.tenantId)))
        throw new ForbiddenError();
      if (endpoint.api === "platform" && auth.tenantId !== undefined) throw new ForbiddenError();
    }
    limitActor(state, auth);

    // 2. Eingaben
    rejectUnsafe(request.params, "/params", locale);
    rejectUnsafe(request.query, "/query", locale);
    rejectUnsafe(request.body, "/body", locale);
    const params = parse(endpoint.params ?? NO_PARAMS, request.params, "/params", locale);
    const query = parse(endpoint.query ?? NO_QUERY, request.query, "/query", locale);
    let body: unknown;
    if (endpoint.body !== undefined) {
      body = parse(endpoint.body, request.body, "/body", locale);
    } else if (request.body !== undefined && request.body !== null) {
      throw new ValidationError({
        detail: BODY_NOT_ALLOWED[locale],
        errors: [{ path: "/body", code: "not_allowed", message: BODY_NOT_ALLOWED[locale] }],
      });
    }
    const ifMatch = readIfMatch(state);
    if (endpoint.api === "admin") checkShopIdHeader(state);
    // Storefront-API: Der Shop kommt aus dem Pfad und gilt für die ganze Anfrage (RLS wie überall).
    if (endpoint.api === "store") {
      const handle = (params as { shopHandle?: unknown }).shopHandle;
      const tenantId =
        typeof handle === "string" && options.storeShops !== undefined
          ? await options.storeShops(handle)
          : undefined;
      if (tenantId === undefined) throw new NotFoundError();
      auth = { actor: { type: "system" }, tenantId, scopes: new Set() };
    }

    // 3. Idempotenz (Architektur 4.5)
    const idem = idempotencyFor(state, auth, body);
    if (idem !== undefined) {
      const start = await options.idempotency.begin(idem);
      if (start.kind === "replay") {
        reply.header("idempotent-replayed", "true");
        return sendJson(reply, start.status, start.body);
      }
    }

    // 4. Ausführung im Anfrage-Kontext, Ausgabe nur über das Antwort-Schema
    const correlation = headerValue(request.headers["x-correlation-id"]);
    let data: unknown;
    try {
      const result = await runWithContext(
        {
          requestId,
          correlationId: correlation !== undefined && isUuid(correlation) ? correlation : requestId,
          ...(auth?.tenantId === undefined ? {} : { tenantId: auth.tenantId }),
          ...(auth === undefined ? {} : { actor: auth.actor }),
        },
        () => endpoint.handler({ params, query, body, requestId, locale, auth, ifMatch, client, setCookie }),
      );
      const output = endpoint.response.schema.safeParse(result);
      if (!output.success) {
        throw new Error(`Antwort von ${endpoint.operationId} passt nicht zum Antwort-Schema`, {
          cause: output.error,
        });
      }
      data = output.data;
    } catch (error) {
      // Nach einem Fehler darf der Aufrufer es mit demselben Schlüssel erneut versuchen.
      if (idem !== undefined) {
        await options.idempotency
          .abandon(idem)
          .catch((e: unknown) =>
            options.logger.error(
              { err: e, requestId },
              "Idempotenz-Schlüssel konnte nicht freigegeben werden",
            ),
          );
      }
      throw error;
    }
    if (idem !== undefined)
      await options.idempotency.complete(idem, { status: endpoint.response.status, body: data });
    flushCookies();
    return sendJson(reply, endpoint.response.status, data);
  } catch (error) {
    flushCookies();
    return sendProblem(reply, error, requestId, locale, options.logger);
  }
}

function idempotencyFor(
  { endpoint, request, locale }: RequestState,
  auth: AuthenticatedActor | undefined,
  body: unknown,
): IdempotencyRequest | undefined {
  if (endpoint.idempotency === "none") return undefined;
  const key = headerValue(request.headers["idempotency-key"]);
  const field = (message: string) =>
    new BadRequestError({
      detail: message,
      errors: [{ path: "/headers/idempotency-key", code: "invalid", message }],
    });
  if (key === undefined) {
    if (endpoint.idempotency === "required") throw field(IDEMPOTENCY_TEXTS.missing[locale]);
    return undefined;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw field(IDEMPOTENCY_TEXTS.format[locale]);
  if (auth?.tenantId === undefined) throw field(IDEMPOTENCY_TEXTS.unsupported[locale]);
  return {
    tenantId: auth.tenantId,
    scope: `${endpoint.api}:${endpoint.operationId}`,
    key,
    requestHash: requestFingerprint({
      actorId: `${auth.actor.type}:${auth.actor.id ?? "-"}`,
      method: endpoint.method,
      path: request.url.split("?")[0] ?? "",
      body,
    }),
  };
}

const IF_MATCH_INVALID: Readonly<Record<Locale, string>> = {
  de: 'If-Match muss die Version aus dem ETag enthalten, zum Beispiel "3".',
  en: 'If-Match must contain the version from the ETag, for example "3".',
};

const IDEMPOTENCY_TEXTS = {
  missing: {
    de: "Für diese Aktion ist die Kopfzeile Idempotency-Key Pflicht.",
    en: "The Idempotency-Key header is required for this action.",
  },
  format: {
    de: "Idempotency-Key: 8 bis 255 Zeichen aus Buchstaben, Ziffern, - und _.",
    en: "Idempotency-Key: 8 to 255 characters from letters, digits, - and _.",
  },
  unsupported: {
    de: "Idempotency-Key wird hier nicht unterstützt.",
    en: "Idempotency-Key is not supported here.",
  },
} as const;
