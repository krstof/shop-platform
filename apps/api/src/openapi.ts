// Erzeugt die OpenAPI-Beschreibungen (Architektur 4.1, API-03) aus genau den Endpunkt-Verträgen,
// aus denen auch die Routen entstehen. Eine Datei je API: admin, store, platform (Architektur 4.2).
// Die Dateien liegen eingecheckt unter openapi/ und werden in der CI auf Aktualität geprüft.
import { API_NAMES, problemSchema, type ApiName, type Endpoint } from "@shop/http";
import { z } from "zod";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export const OPENAPI_VERSION = "3.1.0";

const API_INFO: Readonly<Record<ApiName, { title: string; description: string }>> = {
  admin: {
    title: "Shop-Plattform Admin API",
    description:
      "API für Backoffice, Shop-Editor, KI-Assistent und Skripte. Jede Anfrage gilt für genau einen Shop. " +
      "Fehler im Format Problem Details (RFC 9457), Texte auf Deutsch oder Englisch je nach Accept-Language.",
  },
  store: {
    title: "Shop-Plattform Storefront API",
    description: "Öffentliche API der Shops für Endkunden. Der Shop ergibt sich aus der Domain.",
  },
  platform: {
    title: "Shop-Plattform Platform API",
    description: "API der Plattform-Verwaltung (Betreiber). Kein Zugriff auf Shopdaten.",
  },
};

const PROBLEM_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: "Die Anfrage ist fehlerhaft (zum Beispiel kaputtes JSON).",
  401: "Nicht angemeldet.",
  403: "Berechtigung fehlt.",
  404: "Nicht gefunden, auch bei Datensätzen anderer Shops.",
  409: "Die Aktion passt nicht zum aktuellen Zustand (oder dieselbe Anfrage läuft noch).",
  412: "Der Datensatz wurde inzwischen geändert (If-Match).",
  413: "Die Anfrage ist größer als 1 MB.",
  415: "Nur application/json wird angenommen.",
  428: "If-Match fehlt.",
  422: "Die Eingabe ist ungültig. Die Felder stehen in errors.",
  429: "Zu viele Anfragen.",
  500: "Unerwarteter Fehler, ohne Einzelheiten. requestId hilft bei der Suche im Protokoll.",
};

/** Sammelt benannte Schemas (`.meta({ id })`) als components/schemas und verweist darauf. */
class SchemaCollector {
  readonly components: Record<string, Json> = {};

  convert(schema: z.ZodType, io: "input" | "output"): JsonObject {
    const raw = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io,
      unrepresentable: "throw",
    }) as JsonObject;
    const { $schema: _ignored, $defs, ...rest } = raw;
    void _ignored;
    const rewrite = (value: Json): Json => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value !== null && typeof value === "object") {
        const out: JsonObject = {};
        for (const [k, v] of Object.entries(value)) {
          out[k] =
            k === "$ref" && typeof v === "string"
              ? v.replace(/^#\/\$defs\//, "#/components/schemas/")
              : rewrite(v);
        }
        return out;
      }
      return value;
    };
    if ($defs !== undefined && $defs !== null && typeof $defs === "object" && !Array.isArray($defs)) {
      for (const [id, def] of Object.entries($defs)) this.add(id, rewrite(def));
    }
    // Ein benanntes Schema ganz oben liefert Zod schon als Verweis auf $defs.
    return rewrite(rest) as JsonObject;
  }

  private add(id: string, def: Json): void {
    const existing = this.components[id];
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(def)) {
      throw new Error(`Zwei verschiedene Schemas tragen den Namen ${id}`);
    }
    this.components[id] = def;
  }
}

function parameters(
  schema: z.ZodObject | undefined,
  location: "path" | "query",
  collector: SchemaCollector,
): JsonObject[] {
  if (schema === undefined) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => {
    const converted = collector.convert(field, "input");
    const { description, ...fieldSchema } = converted;
    return {
      name,
      in: location,
      required: location === "path" ? true : !field.isOptional(),
      ...(typeof description === "string" ? { description } : {}),
      schema: fieldSchema,
    };
  });
}

function problemResponse(status: number): JsonObject {
  return {
    description: PROBLEM_DESCRIPTIONS[status] ?? "Fehler",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  };
}

function operation(endpoint: Endpoint, collector: SchemaCollector): JsonObject {
  const scoped = "scopes" in endpoint.access;
  const statuses = new Set<number>([...endpoint.problems, 500]);
  if (scoped) {
    statuses.add(401);
    statuses.add(403);
  }
  if (endpoint.params !== undefined || endpoint.query !== undefined || endpoint.body !== undefined)
    statuses.add(422);
  if (endpoint.body !== undefined) {
    statuses.add(400);
    statuses.add(413);
    statuses.add(415);
  }
  statuses.add(429);
  if (endpoint.idempotency !== "none") {
    statuses.add(400);
    statuses.add(409);
    statuses.add(422);
  }
  if (endpoint.ifMatch === "required") {
    statuses.add(400);
    statuses.add(412);
    statuses.add(428);
  }
  const shape = (endpoint.response.schema as { shape?: Record<string, unknown> }).shape;
  const hasVersion = shape !== undefined && "version" in shape;
  const responses: JsonObject = {
    [String(endpoint.response.status)]: {
      description: endpoint.response.description,
      ...(hasVersion
        ? {
            headers: {
              ETag: {
                description:
                  'Version des Datensatzes, für Änderungen als If-Match zurückschicken, z. B. "3".',
                schema: { type: "string" },
              },
            },
          }
        : {}),
      content: { "application/json": { schema: collector.convert(endpoint.response.schema, "output") } },
    },
  };
  for (const s of [...statuses].sort((a, b) => a - b)) {
    const r = problemResponse(s);
    if (s === 429)
      r["headers"] = {
        "Retry-After": { description: "Sekunden bis zum nächsten Versuch.", schema: { type: "integer" } },
      };
    responses[String(s)] = r;
  }

  const params: JsonObject[] = [
    ...parameters(endpoint.params, "path", collector),
    ...parameters(endpoint.query, "query", collector),
  ];
  if (endpoint.idempotency !== "none") {
    params.push({
      name: "Idempotency-Key",
      in: "header",
      required: endpoint.idempotency === "required",
      description:
        "Zufällige Kennung je Vorgang. Eine Wiederholung mit demselben Schlüssel liefert die gespeicherte Antwort (24 Stunden).",
      schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,255}$" },
    });
  }
  if (endpoint.ifMatch === "required") {
    params.push({
      name: "If-Match",
      in: "header",
      required: true,
      description: 'Version aus dem ETag der letzten Antwort, z. B. "3".',
      schema: { type: "string", pattern: '^"\\d{1,9}"$' },
    });
  }
  return {
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    description: endpoint.description,
    tags: [...endpoint.tags],
    ...(params.length > 0 ? { parameters: params } : {}),
    ...(endpoint.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: collector.convert(endpoint.body, "input"),
                example: endpoint.bodyExample as Json,
              },
            },
          },
        }),
    responses,
    ...("scopes" in endpoint.access
      ? {
          security: [{ session: [] }, { apiToken: [] }],
          "x-required-scopes": [...endpoint.access.scopes],
        }
      : { security: [], "x-public": true, "x-public-reason": endpoint.access.reason }),
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Baut die OpenAPI-Beschreibung einer API. Reihenfolge ist fest, damit die Datei stabil bleibt. */
export function buildOpenApi(api: ApiName, endpoints: readonly Endpoint[]): JsonObject {
  const collector = new SchemaCollector();
  collector.convert(problemSchema, "output");
  const paths: Record<string, JsonObject> = {};
  const mine = endpoints
    .filter((e) => e.api === api)
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method));
  for (const e of mine) {
    const item = (paths[e.fullPath] ??= {});
    item[e.method.toLowerCase()] = operation(e, collector);
  }
  // Verknüpfungen (OpenAPI links): Die ID aus „anlegen“ führt zu „lesen“ und „ändern“.
  // Hilft Menschen, der KI und Schemathesis (zustandsbehaftete Tests) beim Verstehen der Abläufe.
  for (const e of mine) {
    if (e.method !== "POST" || e.response.status !== 201) continue;
    const children = mine.filter((c) =>
      new RegExp(`^${escapeRe(e.fullPath)}/\\{([a-zA-Z0-9]+)\\}$`).test(c.fullPath),
    );
    if (children.length === 0) continue;
    const links: JsonObject = {};
    for (const c of children) {
      const param = /\{([a-zA-Z0-9]+)\}$/.exec(c.fullPath)?.[1] ?? "";
      links[c.operationId] = { operationId: c.operationId, parameters: { [param]: "$response.body#/id" } };
    }
    const response = (paths[e.fullPath]?.["post"] as JsonObject)["responses"] as JsonObject;
    (response["201"] as JsonObject)["links"] = links;
  }
  const schemas = Object.fromEntries(
    Object.entries(collector.components).sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    openapi: OPENAPI_VERSION,
    info: { ...API_INFO[api], version: "1.0.0" },
    paths,
    components: {
      schemas,
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: "shop_session",
          description: "Sitzungs-Cookie nach der Anmeldung (HttpOnly, Secure, SameSite=Lax).",
        },
        apiToken: {
          type: "http",
          scheme: "bearer",
          description:
            "API-Token mit Präfix shp_at_, gebunden an einen Shop und eine Liste von Berechtigungen.",
        },
      },
    },
  };
}

export function buildAllOpenApi(endpoints: readonly Endpoint[]): Record<ApiName, JsonObject> {
  return Object.fromEntries(API_NAMES.map((api) => [api, buildOpenApi(api, endpoints)])) as Record<
    ApiName,
    JsonObject
  >;
}

/**
 * Prüft eine fertige OpenAPI-Datei unabhängig vom Erzeuger (T-09, statischer Teil):
 * jede Operation hat eine eindeutige operationId und erklärt ihre Berechtigung oder ist
 * ausdrücklich öffentlich mit Begründung. Leere Liste heißt: alles in Ordnung.
 */
export function lintOpenApi(doc: JsonObject): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const paths = (doc["paths"] ?? {}) as Record<string, Record<string, JsonObject>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item)) {
      const where = `${method.toUpperCase()} ${path}`;
      const id = op["operationId"];
      if (typeof id !== "string" || id === "") problems.push(`${where}: operationId fehlt`);
      else if (ids.has(id)) problems.push(`${where}: operationId ${id} doppelt`);
      else ids.add(id);
      const scopes = op["x-required-scopes"];
      const isPublic = op["x-public"] === true && typeof op["x-public-reason"] === "string";
      if (!isPublic && (!Array.isArray(scopes) || scopes.length === 0))
        problems.push(`${where}: x-required-scopes fehlt (Standard ist „verboten“)`);
    }
  }
  return problems;
}
