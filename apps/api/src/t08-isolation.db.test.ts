// T-08 (Sicherheit Kapitel 7, B-01), aus OpenAPI erzeugt: Jeder Endpunkt der Admin-API mit einer
// ID im Pfad antwortet für eine ID aus Shop B in Shop A mit 404, genau wie für eine erfundene ID,
// und ändert in Shop B nichts. Jede Liste der Admin-API zeigt in Shop A keinen Datensatz aus Shop B.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCOPES, type AuthenticatedActor, type Scope } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints } from "./endpoints.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";
import { buildRequest, loadOperations } from "./testing/openapi-operations.js";
import { T08_FIXTURES } from "./testing/t08-fixtures.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const USER_A = uuidv7();
const operations = loadOperations(["admin"]);
const withId = operations.filter((o) => o.pathParams.length > 0);
const lists = operations.filter((o) => o.method === "GET" && o.pathParams.length === 0 && o.isPage);
/** Einzelne Datensätze des Shops ohne ID im Pfad, etwa das Aussehen (GET /admin/v1/design). */
const singles = operations.filter((o) => o.method === "GET" && o.pathParams.length === 0 && !o.isPage);

/** Shop A mit allen Berechtigungen: Nur die Mandantentrennung darf B schützen, nicht fehlende Rechte. */
const resolver: ActorResolver = async ({ headers }) => {
  if (headers["x-test-shop"] !== "a") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: USER_A },
    tenantId: TENANT_A,
    scopes: new Set<Scope>(SCOPES),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("T-08: Mandantentrennung für jeden Endpunkt aus OpenAPI", () => {
  const dbName = `t08_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let setup: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  /** IDs in Shop B je Platzhalter. */
  const idsB: Record<string, string> = {};

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    for (const [id, handle] of [
      [TENANT_A, "t08-a"],
      [TENANT_B, "t08-b"],
    ] as const) {
      await setup.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    for (const [name, fixture] of Object.entries(T08_FIXTURES)) {
      idsB[name] = await fixture(setup, TENANT_B);
      await fixture(setup, TENANT_A); // damit Listen in A nicht leer sind
    }
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "t08",
    });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.destroy();
    await setup?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  /** Schnappschuss aller Zeilen von Shop B in allen Tabellen mit Mandant, als Text. */
  async function snapshotB(): Promise<string> {
    const { rows: tables } = await setup.query<{ t: string }>(
      `SELECT format('%I.%I', table_schema, table_name) AS t FROM information_schema.columns
        WHERE column_name = 'tenant_id' AND table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY 1`,
    );
    const parts: string[] = [];
    for (const { t } of tables) {
      const { rows } = await setup.query(`SELECT * FROM ${t} WHERE tenant_id = $1 ORDER BY 1, 2`, [TENANT_B]);
      parts.push(`${t}:${JSON.stringify(rows)}`);
    }
    return parts.join("\n");
  }

  it("es gibt Endpunkte mit ID, und für jeden Platzhalter gibt es eine Testfabrik", () => {
    expect(withId.length).toBeGreaterThan(0);
    const missing = [...new Set(withId.flatMap((o) => o.pathParams))].filter((p) => !(p in T08_FIXTURES));
    expect(missing, "Testfabrik in src/testing/t08-fixtures.ts ergänzen").toEqual([]);
  });

  it.each(withId.map((o) => [`${o.method} ${o.path}`, o] as const))(
    "%s: ID aus Shop B ergibt 404 wie eine erfundene ID, Shop B bleibt unverändert",
    async (_name, op) => {
      const before = await snapshotB();
      const inject = (ids: Record<string, string>) => {
        const req = buildRequest(op, ids);
        req.headers["x-test-shop"] = "a";
        return app.getHttpAdapter().getInstance().inject(req);
      };
      const foreign = await inject(idsB);
      const invented = await inject({});
      expect(foreign.statusCode).toBe(404);
      expect(invented.statusCode).toBe(404);
      const strip = (r: typeof foreign) => ({ ...r.json(), requestId: undefined });
      expect(strip(foreign)).toEqual(strip(invented));
      expect(await snapshotB()).toBe(before);
    },
  );

  it.each(lists.map((o) => [`${o.method} ${o.path}`, o] as const))(
    "%s: Liste in Shop A enthält keinen Datensatz aus Shop B",
    async (_name, op) => {
      const req = buildRequest(op);
      req.headers["x-test-shop"] = "a";
      const r = await app.getHttpAdapter().getInstance().inject(req);
      expect(r.statusCode).toBe(200);
      expect(r.json().data.length).toBeGreaterThan(0);
      for (const id of Object.values(idsB)) expect(r.body).not.toContain(id);
    },
  );

  it.each(singles.map((o) => [`${o.method} ${o.path}`, o] as const))(
    "%s: Antwort in Shop A enthält nichts aus Shop B",
    async (_name, op) => {
      const req = buildRequest(op);
      req.headers["x-test-shop"] = "a";
      const r = await app.getHttpAdapter().getInstance().inject(req);
      expect(r.statusCode).toBe(200);
      for (const id of Object.values(idsB)) expect(r.body).not.toContain(id);
    },
  );
});
