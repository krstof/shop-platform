// T-09 (Sicherheit Kapitel 7), aus OpenAPI erzeugt: Jeder Endpunkt erklärt Berechtigungen, und
// ohne sie kommt 401 (nicht angemeldet) oder 403 (angemeldet, aber eine Berechtigung fehlt).
// Neue Endpunkte sind automatisch dabei, ohne dass jemand hier etwas ergänzen muss.
import { SCOPES, type AuthenticatedActor, type Scope } from "@shop/http";
import { createLogger, uuidv7 } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints, unconnectedDatabase } from "./endpoints.js";
import { memoryIdempotencyStore } from "./idempotency-store.js";
import { buildRequest, loadOperations } from "./testing/openapi-operations.js";

const operations = loadOperations();
const protectedOps = operations.filter((o) => !o.isPublic);

/** Kopfzeile x-test-scopes: Komma-Liste; die Admin-API bekommt einen Shop, die Platform-API keinen. */
const resolver: ActorResolver = async ({ headers }) => {
  const raw = headers["x-test-scopes"];
  if (typeof raw !== "string") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "api_token", id: uuidv7() },
    scopes: new Set(raw.split(",").filter(Boolean) as Scope[]),
    ...(headers["x-test-api"] === "platform" ? {} : { tenantId: uuidv7() }),
  };
  return auth;
};

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await createApi({
    // Ohne Datenbank: Der Wächter muss ablehnen, bevor ein Endpunkt sie bräuchte.
    endpoints: allEndpoints({ database: unconnectedDatabase }),
    resolveActor: resolver,
    logger: createLogger({ level: "silent" }),
    idempotency: memoryIdempotencyStore(),
  });
});
afterAll(async () => {
  await app?.close();
});

describe("T-09: Berechtigungen für jeden Endpunkt aus OpenAPI", () => {
  it("es gibt geprüfte Endpunkte, und jeder registrierte Endpunkt steht in OpenAPI", () => {
    expect(protectedOps.length).toBeGreaterThan(0);
    const documented = new Set(operations.map((o) => o.operationId));
    const registered = allEndpoints({ database: unconnectedDatabase }).map((e) => e.operationId);
    expect(registered.filter((id) => !documented.has(id))).toEqual([]);
    expect([...documented].filter((id) => !registered.includes(id))).toEqual([]);
  });

  it.each(protectedOps.map((o) => [o.operationId, o] as const))("%s: ohne Anmeldung 401", async (_id, op) => {
    const r = await app.getHttpAdapter().getInstance().inject(buildRequest(op));
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe("unauthenticated");
  });

  const cases = protectedOps.flatMap((op) =>
    op.scopes.map((missing) => [op.operationId, missing, op] as const),
  );
  it.each(cases)(
    "%s: ohne %s 403, auch wenn alle anderen Berechtigungen da sind",
    async (_id, missing, op) => {
      const others = SCOPES.filter((s) => s !== missing).join(",");
      const req = buildRequest(op);
      req.headers["x-test-scopes"] = others;
      if (op.api === "platform") req.headers["x-test-api"] = "platform";
      const r = await app.getHttpAdapter().getInstance().inject(req);
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe("forbidden");
    },
  );
});
