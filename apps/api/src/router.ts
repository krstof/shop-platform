// Registriert alle Endpunkte aus den Modulen bei Fastify (ADR-009). Jede Anfrage läuft durch
// dieselbe Kette, kein Endpunkt kann einen Schritt überspringen:
//
//   1. Anmeldung und Berechtigung (globaler Wächter, Q-03): ohne Akteur 401, ohne Scope 403.
//      Die Prüfung kommt vor der Eingabeprüfung, damit Unangemeldete nichts über Schemas erfahren.
//   2. Strenge Prüfung von Pfad, Abfrage und Inhalt mit Zod (Q-02): Fehler ergeben 422.
//   3. Ausführung im Anfrage-Kontext des Kernels (requestId, Mandant, Akteur), sodass
//      withTenantTransaction den Shop kennt, ohne dass ein Endpunkt ihn weiterreichen muss.
//   4. Ausgabe durch das Antwort-Schema: Felder, die dort nicht stehen, gehen nie hinaus.
import type { Endpoint } from "@shop/http";
import {
  ForbiddenError,
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
import type { ActorResolver } from "./actor.js";
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

export function registerEndpoints(fastify: FastifyInstance, options: RouterOptions): void {
  assertUniqueEndpoints(options.endpoints);
  for (const endpoint of options.endpoints) {
    fastify.route({
      method: endpoint.method,
      url: toFastifyPath(endpoint.fullPath),
      // Fehler aus Fastify selbst (Größe, Datenformat, kaputtes JSON) ebenfalls als Problem Details.
      errorHandler: (error, request, reply) =>
        sendProblem(reply, error, request.id, pickLocale(request.headers["accept-language"]), options.logger),
      handler: (request, reply) => handle(endpoint, request, reply, options),
    });
  }
}

async function handle(
  endpoint: Endpoint,
  request: FastifyRequest,
  reply: FastifyReply,
  options: RouterOptions,
): Promise<FastifyReply> {
  const requestId = request.id;
  const locale = pickLocale(request.headers["accept-language"]);
  try {
    // 1. Anmeldung und Berechtigung
    let auth: Awaited<ReturnType<ActorResolver>>;
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

    // 2. Eingaben
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

    // 3. Ausführung im Anfrage-Kontext
    const correlation = headerValue(request.headers["x-correlation-id"]);
    const result = await runWithContext(
      {
        requestId,
        correlationId: correlation !== undefined && isUuid(correlation) ? correlation : requestId,
        ...(auth?.tenantId === undefined ? {} : { tenantId: auth.tenantId }),
        ...(auth === undefined ? {} : { actor: auth.actor }),
      },
      () => endpoint.handler({ params, query, body, requestId, locale, auth }),
    );

    // 4. Ausgabe nur über das Antwort-Schema
    const output = endpoint.response.schema.safeParse(result);
    if (!output.success) {
      throw new Error(`Antwort von ${endpoint.operationId} passt nicht zum Antwort-Schema`, {
        cause: output.error,
      });
    }
    return reply
      .code(endpoint.response.status)
      .header("content-type", "application/json; charset=utf-8")
      .header("cache-control", "no-store")
      .send(JSON.stringify(output.data));
  } catch (error) {
    return sendProblem(reply, error, requestId, locale, options.logger);
  }
}
