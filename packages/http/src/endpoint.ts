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

export const API_NAMES = ["admin", "store", "platform"] as const;
export type ApiName = (typeof API_NAMES)[number];

/** Pfad-Präfix je API (Architektur 4.2 und 4.3). */
export const API_PREFIX: Readonly<Record<ApiName, string>> = {
  admin: "/admin/v1",
  store: "/store/v1",
  platform: "/platform/v1",
};

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type EndpointAccess =
  { readonly scopes: readonly [Scope, ...Scope[]] } | { readonly public: true; readonly reason: string };

/** Wer die Anfrage stellt, nachdem die Anmeldung geprüft wurde. */
export interface AuthenticatedActor {
  readonly actor: Actor;
  /** Shop, für den die Anfrage gilt. Bei der Admin-API immer gesetzt. */
  readonly tenantId?: string;
  /** Schnittmenge aus Rolle und Token (Sicherheit 5.3). */
  readonly scopes: ReadonlySet<Scope>;
}

export interface HandlerContext<P, Q, B> {
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly requestId: string;
  readonly locale: Locale;
  /** Bei öffentlichen Endpunkten leer. Der Mandant steht zusätzlich im Anfrage-Kontext des Kernels. */
  readonly auth: AuthenticatedActor | undefined;
}

/** Fehler-Statuscodes, die ein Endpunkt in OpenAPI dokumentiert (401, 403, 422, 500 kommen immer dazu). */
export type DocumentedProblem = 400 | 404 | 409 | 412 | 413 | 415 | 429;

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
  readonly response: { readonly status: 200 | 201; readonly description: string; readonly schema: z.ZodType };
  readonly problems: readonly DocumentedProblem[];
  readonly handler: (ctx: HandlerContext<unknown, unknown, unknown>) => Promise<unknown>;
}

export class EndpointDefinitionError extends Error {
  constructor(operationId: string, problems: readonly string[]) {
    super(`Endpunkt ${operationId || "(ohne operationId)"} ist ungültig:\n  - ${problems.join("\n  - ")}`);
    this.name = "EndpointDefinitionError";
  }
}

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
  const access = spec.access as Partial<{ scopes: readonly string[]; public: boolean; reason: string }>;
  if (access.public === true) {
    if (spec.api !== "store") p.push("nur die Storefront-API darf öffentliche Endpunkte haben");
    if (typeof access.reason !== "string" || access.reason.trim().length < 10)
      p.push("öffentlicher Endpunkt braucht eine Begründung (reason)");
    if (access.scopes !== undefined) p.push("öffentlich und Berechtigungen schließen sich aus");
  } else if (!Array.isArray(access.scopes) || access.scopes.length === 0) {
    p.push("Berechtigung fehlt: access.scopes muss mindestens einen Eintrag haben");
  } else {
    for (const s of access.scopes) if (!isScope(s)) p.push(`unbekannte Berechtigung „${s}“`);
    if (new Set(access.scopes).size !== access.scopes.length) p.push("doppelte Berechtigung");
  }

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
