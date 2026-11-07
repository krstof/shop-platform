// Gerüst der API ohne Datenbank: Wächter, Eingabeprüfung, Fehlerformat, Sprache, Ausgabefilter.
import { defineEndpoint, idParam, listQuery, type AuthenticatedActor, type Scope } from "@shop/http";
import { ConflictError, createLogger, getContext, uuidv7 } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ActorResolver } from "./actor.js";
import { BODY_LIMIT_BYTES, createApi, LIVENESS_PATH } from "./app.js";
import { memoryIdempotencyStore } from "./idempotency-store.js";

const TENANT = uuidv7();
const USER = uuidv7();

/** Test-Anmeldung: Kopfzeile `x-test-scopes` mit Komma-Liste; `x-test-tenant: none` ohne Shop. */
const testResolver: ActorResolver = async ({ headers }) => {
  const scopes = headers["x-test-scopes"];
  if (typeof scopes !== "string") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: USER },
    scopes: new Set(scopes.split(",").filter(Boolean) as Scope[]),
    ...(headers["x-test-tenant"] === "none" ? {} : { tenantId: TENANT }),
  };
  return auth;
};

const echo = defineEndpoint({
  api: "admin",
  method: "GET",
  path: "/things/{thingId}",
  operationId: "getThing",
  summary: "Ding lesen",
  description: "Testendpunkt: gibt Kontext und Eingaben zurück.",
  tags: ["Test"],
  access: { scopes: ["products:read"] },
  params: z.strictObject({ thingId: idParam }),
  query: listQuery(),
  response: {
    status: 200,
    description: "Echo",
    schema: z.object({ thingId: z.string(), limit: z.number(), tenantId: z.string(), requestId: z.string() }),
  },
  handler: async ({ params, query, requestId }) => ({
    thingId: params.thingId,
    limit: query.limit,
    tenantId: getContext()?.tenantId ?? "",
    requestId,
    // Feld, das nicht im Antwort-Schema steht: darf nie hinausgehen.
    passwordHash: "geheim",
  }),
});

const create = defineEndpoint({
  api: "admin",
  method: "POST",
  path: "/things",
  operationId: "createThing",
  summary: "Ding anlegen",
  description: "Testendpunkt mit strengem Inhalt.",
  tags: ["Test"],
  access: { scopes: ["products:write"] },
  body: z.strictObject({
    name: z.string().min(3).max(50),
    tags: z.array(z.string().max(10)).max(3).optional(),
  }),
  bodyExample: { name: "Tee" },
  response: { status: 201, description: "Angelegt", schema: z.object({ name: z.string() }) },
  handler: async ({ body }) => {
    if (body.name === "Konflikt") throw new ConflictError({ detail: "Gibt es schon." });
    if (body.name === "Absturz") throw new Error('relation "catalog.secret" does not exist');
    if (body.name === "Kaputt") return { wrong: 1 } as unknown as { name: string };
    return { name: body.name };
  },
});

const platformOnly = defineEndpoint({
  api: "platform",
  method: "GET",
  path: "/tenants",
  operationId: "listTenantsTest",
  summary: "Shops auflisten",
  description: "Testendpunkt der Platform-API.",
  tags: ["Test"],
  access: { scopes: ["platform:read"] },
  response: { status: 200, description: "ok", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

let app: NestFastifyApplication;
const lines: string[] = [];
const logger = createLogger({ level: "debug", destination: { write: (l: string) => void lines.push(l) } });

beforeAll(async () => {
  app = await createApi({
    endpoints: [echo, create, platformOnly],
    resolveActor: testResolver,
    logger,
    idempotency: memoryIdempotencyStore(),
  });
});
afterAll(async () => {
  await app?.close();
});

const fastify = () => app.getHttpAdapter().getInstance();
const ID = "0192f1c4-7a1e-7c3b-8000-000000000001";

describe("Wächter (Q-03, Sicherheit 5.3)", () => {
  it("ohne Anmeldung 401 als Problem Details", async () => {
    const r = await fastify().inject({ method: "GET", url: `/admin/v1/things/${ID}` });
    expect(r.statusCode).toBe(401);
    expect(r.headers["content-type"]).toBe("application/problem+json; charset=utf-8");
    expect(r.headers["www-authenticate"]).toBe("Bearer");
    expect(r.json()).toMatchObject({ status: 401, code: "unauthenticated", title: "Bitte melde dich an." });
  });

  it("ohne passende Berechtigung 403", async () => {
    const r = await fastify().inject({
      method: "GET",
      url: `/admin/v1/things/${ID}`,
      headers: { "x-test-scopes": "orders:read,products:write" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("forbidden");
  });

  it("prüft die Berechtigung vor der Eingabe: Unangemeldete erfahren nichts über das Schema", async () => {
    const r = await fastify().inject({ method: "GET", url: "/admin/v1/things/keine-uuid?limit=999" });
    expect(r.statusCode).toBe(401);
    expect(r.json().errors).toBeUndefined();
  });

  it("Admin-API ohne Shop ergibt 403", async () => {
    const r = await fastify().inject({
      method: "GET",
      url: `/admin/v1/things/${ID}`,
      headers: { "x-test-scopes": "products:read", "x-test-tenant": "none" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("Platform-API mit Shop-Akteur ergibt 403", async () => {
    const r = await fastify().inject({
      method: "GET",
      url: "/platform/v1/tenants",
      headers: { "x-test-scopes": "platform:read" },
    });
    expect(r.statusCode).toBe(403);
    const ok = await fastify().inject({
      method: "GET",
      url: "/platform/v1/tenants",
      headers: { "x-test-scopes": "platform:read", "x-test-tenant": "none" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("mit Berechtigung: Mandant im Kontext, Felder außerhalb des Antwort-Schemas gehen nicht hinaus", async () => {
    const r = await fastify().inject({
      method: "GET",
      url: `/admin/v1/things/${ID}?limit=5`,
      headers: { "x-test-scopes": "products:read" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toEqual({ thingId: ID, limit: 5, tenantId: TENANT, requestId: r.headers["x-request-id"] });
    expect(r.body).not.toContain("geheim");
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});

describe("Eingabeprüfung (Q-02)", () => {
  const auth = { "x-test-scopes": "products:read,products:write" };

  it("ungültige ID im Pfad ergibt 422 mit Feld /params/thingId", async () => {
    const r = await fastify().inject({ method: "GET", url: "/admin/v1/things/1%20OR%201=1", headers: auth });
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.map((e: { path: string }) => e.path)).toEqual(["/params/thingId"]);
  });

  it("unbekannter Abfrageparameter und zu großes limit ergeben 422", async () => {
    const r = await fastify().inject({
      method: "GET",
      url: `/admin/v1/things/${ID}?limit=101&tenantId=${ID}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(422);
    expect(
      r
        .json()
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(["/query/limit", "/query/tenantId"]);
  });

  it("Mass Assignment: unbekannte Felder im Inhalt ergeben 422 (B-06)", async () => {
    const r = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: auth,
      payload: { name: "Tee", tenantId: ID, status: "paid" },
    });
    expect(r.statusCode).toBe(422);
    expect(
      r
        .json()
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(["/body/status", "/body/tenantId"]);
  });

  it("gültiger Inhalt ergibt 201", async () => {
    const r = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: auth,
      payload: { name: "Tee" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ name: "Tee" });
  });

  it("fehlender Inhalt ergibt 422, kaputtes JSON 400, Text statt JSON 415", async () => {
    const empty = await fastify().inject({ method: "POST", url: "/admin/v1/things", headers: auth });
    expect(empty.statusCode).toBe(422);
    const broken = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: { ...auth, "content-type": "application/json" },
      payload: '{"name": "Tee"',
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({
      code: "bad_request",
      detail: "Der Inhalt ist kein gültiges JSON.",
    });
    const text = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: { ...auth, "content-type": "text/plain" },
      payload: "name=Tee",
    });
    expect(text.statusCode).toBe(415);
    expect(text.json().code).toBe("unsupported_media_type");
  });

  it("Prototype Pollution über __proto__ wird abgelehnt", async () => {
    const r = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: { ...auth, "content-type": "application/json" },
      payload: '{"name":"Tee","__proto__":{"admin":true}}',
    });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    expect(({} as Record<string, unknown>)["admin"]).toBeUndefined();
  });

  it("Anfragen über 1 MB ergeben 413", async () => {
    const r = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: { ...auth, "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(BODY_LIMIT_BYTES) }),
    });
    expect(r.statusCode).toBe(413);
    expect(r.json().code).toBe("payload_too_large");
  });
});

describe("Fehlerformat (Q-05) und Sprache", () => {
  const auth = { "x-test-scopes": "products:write" };

  it("fachlicher Fehler mit Einzelheiten, unerwarteter Fehler ohne", async () => {
    const conflict = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: auth,
      payload: { name: "Konflikt" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "conflict", detail: "Gibt es schon." });

    lines.length = 0;
    const crash = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: auth,
      payload: { name: "Absturz" },
    });
    expect(crash.statusCode).toBe(500);
    expect(crash.body).not.toMatch(/relation|catalog|secret/);
    expect(crash.json().requestId).toBe(crash.headers["x-request-id"]);
    // Ins Protokoll gehört der Fehler, mit derselben requestId.
    expect(lines.some((l) => l.includes(crash.json().requestId) && l.includes("unerwartetem Fehler"))).toBe(
      true,
    );
  });

  it("Antwort, die nicht zum Antwort-Schema passt, ergibt 500 statt Datenleck", async () => {
    const r = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: auth,
      payload: { name: "Kaputt" },
    });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain("wrong");
  });

  it("Accept-Language: en ergibt englische Titel und Feldtexte", async () => {
    const r = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: { ...auth, "accept-language": "en-US,en;q=0.9" },
      payload: { name: "x", extra: 1 },
    });
    expect(r.statusCode).toBe(422);
    const body = r.json();
    expect(body.title).toBe("The input is invalid.");
    expect(body.detail).toBe("2 fields are invalid.");
    expect(body.errors.find((e: { path: string }) => e.path === "/body/extra").message).toBe(
      "This field is not allowed.",
    );
    const de = await fastify().inject({
      method: "POST",
      url: "/admin/v1/things",
      headers: auth,
      payload: { name: "x" },
    });
    expect(de.json().title).toBe("Die Eingabe ist ungültig.");
    expect(de.json().errors[0].message).not.toBe(
      body.errors.find((e: { path: string }) => e.path === "/body/name").message,
    );
  });

  it("unbekannte Adresse ergibt 404 als Problem Details", async () => {
    const r = await fastify().inject({
      method: "GET",
      url: "/admin/v1/gibt-es-nicht",
      headers: { "accept-language": "en" },
    });
    expect(r.statusCode).toBe(404);
    expect(r.headers["content-type"]).toBe("application/problem+json; charset=utf-8");
    expect(r.json()).toMatchObject({ code: "not_found", title: "Not found." });
    expect(r.json().requestId).toBe(r.headers["x-request-id"]);
  });

  it("jede Antwort hat eine eigene requestId (UUIDv7), mitgeschickte werden nicht übernommen", async () => {
    const a = await fastify().inject({ method: "GET", url: "/x", headers: { "x-request-id": "boese" } });
    const b = await fastify().inject({ method: "GET", url: "/x" });
    expect(a.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers["x-request-id"]).not.toBe("boese");
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});

describe("Lebenszeichen für den Container", () => {
  it("antwortet ohne Anmeldung mit 200 und den Sicherheits-Headern, nur für GET und HEAD", async () => {
    const r = await fastify().inject({ method: "GET", url: LIVENESS_PATH });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: "ok" });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect((await fastify().inject({ method: "HEAD", url: LIVENESS_PATH })).statusCode).toBe(200);
    expect((await fastify().inject({ method: "POST", url: LIVENESS_PATH, payload: {} })).statusCode).toBe(
      404,
    );
  });
});

describe("Liste der Endpunkte", () => {
  it("doppelte operationId oder Route lässt den Start scheitern", async () => {
    await expect(
      createApi({
        endpoints: [echo, echo],
        resolveActor: testResolver,
        logger,
        idempotency: memoryIdempotencyStore(),
      }),
    ).rejects.toThrow(/operationId doppelt: getThing/);
  });
});

describe("Funde von Schemathesis (T-12) als feste Tests", () => {
  const auth = { "x-test-scopes": "products:read,products:write" };

  it("NUL-Zeichen und einzelne Ersatzzeichen im Inhalt ergeben 422 statt 500", async () => {
    for (const payload of [
      '{"name":"Te\\u0000e"}',
      '{"name":"Te\\udbe7e"}',
      '{"name":"Tee","tags":["a\\u0000"]}',
    ]) {
      const r = await fastify().inject({
        method: "POST",
        url: "/admin/v1/things",
        headers: { ...auth, "content-type": "application/json" },
        payload,
      });
      expect(r.statusCode).toBe(422);
      expect(r.json().errors[0].code).toBe("invalid_characters");
    }
  });

  it("kaputte Kopfzeile Shop-Id ergibt 400, eine gültige wird angenommen", async () => {
    for (const shopId of ["aQ", "?`V2\\MaU&d%9=", "", [ID, ID]]) {
      const r = await fastify().inject({
        method: "GET",
        url: `/admin/v1/things/${ID}`,
        headers: { ...auth, "shop-id": shopId },
      });
      expect(r.statusCode, String(shopId)).toBe(400);
      expect(r.json().errors[0].path).toBe("/headers/shop-id");
    }
    const ok = await fastify().inject({
      method: "GET",
      url: `/admin/v1/things/${ID}`,
      headers: { ...auth, "shop-id": TENANT.toUpperCase() },
    });
    expect(ok.statusCode).not.toBe(400);
  });

  it("bekannte Adresse mit falscher Methode ergibt 405 mit Allow, auch QUERY und TRACE", async () => {
    for (const method of ["DELETE", "PUT", "TRACE", "QUERY", "OPTIONS"] as const) {
      const r = await fastify().inject({ method, url: `/admin/v1/things/${ID}`, headers: auth });
      expect(r.statusCode, method).toBe(405);
      expect(r.headers["allow"]).toBe("GET, HEAD");
      expect(r.json().code).toBe("method_not_allowed");
    }
  });
});
