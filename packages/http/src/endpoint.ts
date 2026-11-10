// Vertrag eines Endpunkts (Architektur 4, ADR-009). Jedes Modul beschreibt seine Endpunkte mit
// `defineEndpoint`: Pfad, Methode, operationId, Berechtigung, Zod-Schemas für Ein- und Ausgabe und
// die Funktion, die die Anfrage bearbeitet. Aus genau dieser Beschreibung entstehen
// die Routen der API, die Prüfung jeder Anfrage und die OpenAPI-Datei. Es gibt keinen zweiten Weg,
// einen Endpunkt anzulegen; deshalb kann kein Endpunkt seine Berechtigung vergessen (Q-03).
//
// Regeln, die schon beim Laden geprüft werden (Fehler = Programm startet nicht, Build scheitert):
// - Admin- und Platform-API verlangen immer mindestens eine Berechtigung. Nur die Storefront-API
//   darf öffentliche Endpunkte haben, und auch dann nur mit Begründung.
// - Eingabeschemas sind auf allen Ebenen streng: unbekannte Felder ergeben 422 (Q-02, Sicherheit 5.4).
// - Pfadplatzhalter und Pfad-Schema passen genau zusammen.
import type { Actor, Locale } from "@shop/kernel";
import type { z } from "zod";
import { isScope, type Scope } from "./scopes.js";

export const API_NAMES = ["admin", "store", "platform", "auth"] as const;
export type ApiName = (typeof API_NAMES)[number];

/** Pfad-Präfix je API (Architektur 4.2 und 4.3). */
export const API_PREFIX: Readonly<Record<ApiName, string>> = {
  admin: "/admin/v1",
  store: "/store/v1",
  platform: "/platform/v1",
  /** Anmelden, Abmelden, eigene Sitzung (E6). Gilt für Backoffice und Plattform-Verwaltung. */
  auth: "/auth/v1",
};

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Wer einen Endpunkt aufrufen darf:
 * - `scopes`: angemeldet und mit allen genannten Berechtigungen (Normalfall).
 * - `signedIn`: angemeldet, ohne bestimmte Berechtigung. Nur in der Auth-API („Wer bin ich“).
 * - `public`: ohne Anmeldung, mit Begründung. Nur in Storefront- und Auth-API.
 */
export type EndpointAccess =
  | { readonly scopes: readonly [Scope, ...Scope[]] }
  | { readonly signedIn: true }
  | { readonly public: true; readonly reason: string };

/** Angaben zum Aufrufer, die nur die Auth-API braucht (Bremse je Netz, Sitzungsliste, Cookie). */
export interface ClientInfo {
  /** Absenderadresse, wie Fastify sie ermittelt hat (hinter Caddy aus X-Forwarded-For des Proxys). */
  readonly ip: string;
  readonly userAgent: string | undefined;
  /** Rohe Kopfzeile `Cookie`. */
  readonly cookie: string | undefined;
}

/** Wer die Anfrage stellt, nachdem die Anmeldung geprüft wurde. */
export interface AuthenticatedActor {
  readonly actor: Actor;
  /** Shop, für den die Anfrage gilt. Bei der Admin-API immer gesetzt. */
  readonly tenantId?: string;
  /** Schnittmenge aus Rolle und Token (Sicherheit 5.3). */
  readonly scopes: ReadonlySet<Scope>;
  /**
   * Nur bei Sitzungen: Wann das Passwort zuletzt eingegeben wurde (Anmeldung oder
   * POST /auth/v1/confirm-password). Kritische Aktionen verlangen höchstens 15 Minuten
   * (Sicherheit 5.3). Bei API-Token nie gesetzt.
   */
  readonly passwordConfirmedAt?: Date;
}

export interface HandlerContext<P, Q, B> {
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly requestId: string;
  readonly locale: Locale;
  /** Bei öffentlichen Endpunkten leer. Der Mandant steht zusätzlich im Anfrage-Kontext des Kernels. */
  readonly auth: AuthenticatedActor | undefined;
  /** Version aus `If-Match` (Architektur 4.6). Bei `ifMatch: "required"` immer gesetzt. */
  readonly ifMatch: number | undefined;
  /** Nur in der Auth-API gesetzt, sonst `undefined`: Kein Fachmodul sieht Cookies oder Adressen. */
  readonly client: ClientInfo | undefined;
  /**
   * Hängt eine `Set-Cookie`-Zeile an die Antwort (auch an eine Fehlerantwort, etwa zum Löschen).
   * Nur in der Auth-API erlaubt; sonst wirft der Aufruf.
   */
  readonly setCookie: (line: string) => void;
}

/**
 * Bereiche der Anfragebremse (Sicherheit 5.8). Ohne Angabe gilt der Bereich der API:
 * admin, platform, bei der Storefront-API store-read für GET und store-write sonst.
 */
export const RATE_LIMIT_CATEGORIES = [
  "admin",
  "platform",
  "store-read",
  "store-write",
  "login",
  "coupon",
] as const;
export type RateLimitCategory = (typeof RATE_LIMIT_CATEGORIES)[number];

/**
 * Zusätzliche Fehler-Statuscodes, die ein Endpunkt in OpenAPI dokumentiert. Was aus Zugang,
 * Eingaben und Methode folgt (401, 403, 422, 429, 500 ...), ergänzt die Erzeugung von selbst.
 */
export type DocumentedProblem = 400 | 401 | 404 | 409 | 412 | 413 | 415 | 428 | 429;

type AnyObject = z.ZodObject;

export interface EndpointSpec<
  P extends AnyObject | undefined,
  Q extends AnyObject | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
> {
  readonly api: ApiName;
  readonly method: HttpMethod;
  /** Pfad ohne API-Präfix, Platzhalter in geschweiften Klammern: `/manufacturers/{manufacturerId}`. */
  readonly path: string;
  /** Eindeutiger Name, später auch Name des KI-Werkzeugs (Architektur 4.8): `listManufacturers`. */
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly [string, ...string[]];
  readonly access: EndpointAccess;
  readonly params?: P;
  readonly query?: Q;
  readonly body?: B;
  /** Pflicht, wenn es einen body gibt: gültiges Beispiel für Dokumentation, KI und Tests (T-08). */
  readonly bodyExample?: B extends z.ZodType ? z.input<B> : never;
  /**
   * Nur bei POST: `Idempotency-Key` erlaubt (Standard) oder Pflicht (Checkout, Zahlung, Erstattung).
   * „none“ nur mit gutem Grund, zum Beispiel bei rein lesenden POST-Suchen.
   */
  readonly idempotency?: "optional" | "required" | "none";
  /** Nur bei PATCH, PUT und DELETE: Änderung nur mit passender Version (`If-Match`, Architektur 4.6). */
  readonly ifMatch?: "required";
  readonly rateLimit?: RateLimitCategory;
  /**
   * Größere Anfragen als die üblichen 1 MB erlauben, in Bytes (höchstens 16 MB). Nur für Endpunkte
   * mit body, etwa beim Hochladen von Bildern (M2 Teil 2). Caddy braucht dafür eine passende Regel.
   */
  readonly bodyLimit?: number;
  readonly response: { readonly status: 200 | 201; readonly description: string; readonly schema: R };
  readonly problems?: readonly DocumentedProblem[];
  readonly handler: (ctx: HandlerContext<Infer<P>, Infer<Q>, Infer<B>>) => Promise<z.input<R>>;
}

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

/** Endpunkt nach der Prüfung, ohne Typparameter, so wie ihn Router und OpenAPI-Erzeugung sehen. */
export interface Endpoint {
  readonly api: ApiName;
  readonly method: HttpMethod;
  readonly path: string;
  /** Voller Pfad mit Präfix, zum Beispiel `/admin/v1/manufacturers/{manufacturerId}`. */
  readonly fullPath: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly access: EndpointAccess;
  readonly params: AnyObject | undefined;
  readonly query: AnyObject | undefined;
  readonly body: z.ZodType | undefined;
  readonly bodyExample: unknown;
  readonly idempotency: "optional" | "required" | "none";
  readonly ifMatch: "required" | undefined;
  readonly rateLimit: RateLimitCategory;
  /** Eigene Höchstgröße der Anfrage in Bytes; `undefined` = Standard der API (1 MB). */
  readonly bodyLimit: number | undefined;
  readonly response: { readonly status: 200 | 201; readonly description: string; readonly schema: z.ZodType };
  readonly problems: readonly DocumentedProblem[];
  readonly handler: (ctx: HandlerContext<unknown, unknown, unknown>) => Promise<unknown>;
}

function defaultRateLimit(api: ApiName, method: HttpMethod): RateLimitCategory {
  if (api === "store") return method === "GET" ? "store-read" : "store-write";
  if (api === "auth") return method === "GET" ? "admin" : "login";
  return api;
}

export class EndpointDefinitionError extends Error {
  constructor(operationId: string, problems: readonly string[]) {
    super(`Endpunkt ${operationId || "(ohne operationId)"} ist ungültig:\n  - ${problems.join("\n  - ")}`);
    this.name = "EndpointDefinitionError";
  }
}

/** Obergrenze für `bodyLimit` (16 MB). */
export const MAX_BODY_LIMIT = 16 * 1024 * 1024;

const OPERATION_ID = /^[a-z][a-zA-Z0-9]{2,63}$/;
const SEGMENT = /^([a-z0-9]+(-[a-z0-9]+)*|\{[a-z][a-zA-Z0-9]*\})$/;

export function defineEndpoint<
  P extends AnyObject | undefined = undefined,
  Q extends AnyObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  R extends z.ZodType = z.ZodType,
>(spec: EndpointSpec<P, Q, B, R>): Endpoint {
  const problems = validateSpec(spec as unknown as EndpointSpec<AnyObject, AnyObject, z.ZodType, z.ZodType>);
  if (problems.length > 0) throw new EndpointDefinitionError(spec.operationId, problems);
  return Object.freeze({
    api: spec.api,
    method: spec.method,
    path: spec.path,
    fullPath: API_PREFIX[spec.api] + spec.path,
    operationId: spec.operationId,
    summary: spec.summary,
    description: spec.description,
    tags: Object.freeze([...spec.tags]),
    access: spec.access,
    params: spec.params,
    query: spec.query,
    body: spec.body,
    bodyExample: spec.bodyExample,
    idempotency: spec.method === "POST" ? (spec.idempotency ?? "optional") : "none",
    ifMatch: spec.ifMatch,
    rateLimit: spec.rateLimit ?? defaultRateLimit(spec.api, spec.method),
    bodyLimit: spec.bodyLimit,
    response: spec.response,
    problems: Object.freeze([...(spec.problems ?? [])]),
    handler: spec.handler as Endpoint["handler"],
  });
}

function validateSpec(spec: EndpointSpec<AnyObject, AnyObject, z.ZodType, z.ZodType>): string[] {
  const p: string[] = [];
  if (!(spec.api in API_PREFIX)) p.push(`unbekannte API „${String(spec.api)}“`);
  if (!(HTTP_METHODS as readonly string[]).includes(spec.method))
    p.push(`unbekannte Methode „${spec.method}“`);
  if (!OPERATION_ID.test(spec.operationId)) p.push("operationId muss camelCase sein (3 bis 64 Zeichen)");
  if (spec.summary.trim().length < 5) p.push("summary fehlt");
  if (spec.description.trim().length < 10) p.push("description fehlt");

  // Berechtigung (Q-03, Sicherheit 5.3): Standard ist „verboten“.
  const access = spec.access as Partial<{
    scopes: readonly string[];
    public: boolean;
    signedIn: boolean;
    reason: string;
  }>;
  const kinds = [access.scopes !== undefined, access.public !== undefined, access.signedIn !== undefined];
  if (kinds.filter(Boolean).length > 1) p.push("access: scopes, signedIn und public schließen sich aus");
  if (access.public !== undefined) {
    if (access.public !== true) p.push("access.public muss true sein");
    if (spec.api !== "store" && spec.api !== "auth")
      p.push("nur die Storefront- und die Auth-API dürfen öffentliche Endpunkte haben");
    if (typeof access.reason !== "string" || access.reason.trim().length < 10)
      p.push("öffentlicher Endpunkt braucht eine Begründung (reason)");
  } else if (access.signedIn !== undefined) {
    if (access.signedIn !== true) p.push("access.signedIn muss true sein");
    if (spec.api !== "auth") p.push("signedIn ohne Berechtigung gibt es nur in der Auth-API");
  } else if (!Array.isArray(access.scopes) || access.scopes.length === 0) {
    p.push("Berechtigung fehlt: access.scopes muss mindestens einen Eintrag haben");
  } else {
    if (spec.api === "auth") p.push("die Auth-API kennt keine Berechtigungen (signedIn oder public)");
    for (const s of access.scopes) if (!isScope(s)) p.push(`unbekannte Berechtigung „${s}“`);
    if (new Set(access.scopes).size !== access.scopes.length) p.push("doppelte Berechtigung");
  }
  // Anmelden und Abmelden laufen ohne Idempotenz-Schlüssel (ein Passwort gehört nie in einen Speicher).
  if (spec.api === "auth" && spec.method === "POST" && spec.idempotency !== "none")
    p.push('POST in der Auth-API braucht idempotency: "none"');

  // Pfad und Platzhalter
  if (!spec.path.startsWith("/") || spec.path.endsWith("/")) {
    p.push("path muss mit / beginnen und darf nicht mit / enden");
  } else {
    const segments = spec.path.slice(1).split("/");
    const bad = segments.filter((s) => !SEGMENT.test(s));
    if (bad.length > 0) p.push(`ungültige Pfadteile (kebab-case oder {camelCase}): ${bad.join(", ")}`);
    const placeholders = segments.filter((s) => s.startsWith("{")).map((s) => s.slice(1, -1));
    const keys = spec.params === undefined ? [] : Object.keys(spec.params.shape);
    const missing = placeholders.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !placeholders.includes(k));
    if (missing.length > 0) p.push(`Platzhalter ohne Schema in params: ${missing.join(", ")}`);
    if (extra.length > 0) p.push(`params-Felder ohne Platzhalter im Pfad: ${extra.join(", ")}`);
  }

  // Storefront-API (M4): Der Shop steht immer im Pfad, damit jede Anfrage genau einem Shop gilt.
  if (spec.api === "store" && !spec.path.startsWith("/shops/{shopHandle}"))
    p.push("Pfade der Storefront-API beginnen mit /shops/{shopHandle}");
  if (spec.body !== undefined && (spec.method === "GET" || spec.method === "DELETE"))
    p.push(`${spec.method} darf keinen body haben`);

  // Strenge Eingabeschemas (Q-02)
  for (const [part, schema] of [
    ["params", spec.params],
    ["query", spec.query],
    ["body", spec.body],
  ] as const) {
    if (schema === undefined) continue;
    if (part !== "body" && defOf(schema).type !== "object") p.push(`${part} muss ein Objekt-Schema sein`);
    p.push(...findLooseObjects(schema, `/${part}`));
  }
  if (spec.body !== undefined) {
    if (spec.bodyExample === undefined) p.push("bodyExample fehlt (Pflicht bei body)");
    else {
      const r = spec.body.safeParse(spec.bodyExample);
      if (!r.success) p.push("bodyExample passt nicht zum body-Schema");
    }
  } else if (spec.bodyExample !== undefined) p.push("bodyExample ohne body");
  if (spec.idempotency !== undefined && spec.method !== "POST") p.push("idempotency gibt es nur bei POST");
  if (spec.ifMatch !== undefined && !["PATCH", "PUT", "DELETE"].includes(spec.method))
    p.push("ifMatch gibt es nur bei PATCH, PUT und DELETE");
  if (spec.rateLimit !== undefined && !(RATE_LIMIT_CATEGORIES as readonly string[]).includes(spec.rateLimit))
    p.push(`unbekannter Bereich der Anfragebremse „${spec.rateLimit}“`);
  if (spec.bodyLimit !== undefined) {
    if (spec.body === undefined) p.push("bodyLimit nur bei Endpunkten mit body");
    if (!Number.isInteger(spec.bodyLimit) || spec.bodyLimit <= 1_048_576 || spec.bodyLimit > MAX_BODY_LIMIT)
      p.push("bodyLimit muss eine ganze Zahl über 1 MB und höchstens 16 MB sein");
  }
  if (spec.response.status !== 200 && spec.response.status !== 201)
    p.push("response.status muss 200 oder 201 sein");
  return p;
}

interface ZodDefLike {
  readonly type: string;
  readonly shape?: Record<string, z.ZodType>;
  readonly catchall?: z.ZodType;
  readonly innerType?: z.ZodType;
  readonly element?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly left?: z.ZodType;
  readonly right?: z.ZodType;
  readonly in?: z.ZodType;
  readonly valueType?: z.ZodType;
}

function defOf(schema: z.ZodType): ZodDefLike {
  return (schema as unknown as { _zod: { def: ZodDefLike } })._zod.def;
}

/**
 * Sucht Objekt-Schemas, die unbekannte Felder durchlassen würden (nicht `z.strictObject`).
 * Gibt die Fundstellen als Pfade zurück; leer heißt: alles streng.
 */
export function findLooseObjects(schema: z.ZodType, path = ""): string[] {
  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      const out: string[] = [];
      if (def.catchall === undefined || defOf(def.catchall).type !== "never")
        out.push(`${path || "/"}: Objekt ist nicht streng (z.strictObject verwenden)`);
      for (const [key, child] of Object.entries(def.shape ?? {}))
        out.push(...findLooseObjects(child, `${path}/${key}`));
      return out;
    }
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional":
    case "catch":
      return def.innerType === undefined ? [] : findLooseObjects(def.innerType, path);
    case "array":
      return def.element === undefined ? [] : findLooseObjects(def.element, `${path}/0`);
    case "union":
      return (def.options ?? []).flatMap((o) => findLooseObjects(o, path));
    case "intersection":
      return [
        ...(def.left === undefined ? [] : findLooseObjects(def.left, path)),
        ...(def.right === undefined ? [] : findLooseObjects(def.right, path)),
      ];
    case "pipe":
      return def.in === undefined ? [] : findLooseObjects(def.in, path);
    case "record":
      return def.valueType === undefined ? [] : findLooseObjects(def.valueType, `${path}/*`);
    default:
      return [];
  }
}
