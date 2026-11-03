// Beispiel-Endpunkte gegen eine echte Datenbank (Architektur 5.7): Shop A sieht nur seine
// Hersteller, IDs aus Shop B ergeben 404 (T-08 für diese Endpunkte, der Generator für alle
// Endpunkte folgt mit E4 Teil 2), Seiten mit Cursor ohne Lücken und Doppelte.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints } from "./endpoints.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const COUNT_A = 7;

/** Anmeldung im Test: Kopfzeile x-test-shop wählt den Shop, immer mit products:read. */
const resolver: ActorResolver = async ({ headers }) => {
  const shop = headers["x-test-shop"];
  if (shop !== "a" && shop !== "b") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: uuidv7() },
    tenantId: shop === "a" ? TENANT_A : TENANT_B,
    scopes: new Set(["products:read"]),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Hersteller-Endpunkte (echte Datenbank)", () => {
  const dbName = `api_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let database: Database<unknown>;
  let appUrl: string;
  let app: NestFastifyApplication;
  const idsB: string[] = [];
  const archivedId = uuidv7();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    // Ohne Rollen-Passwörter: Andere Pakete testen gleichzeitig auf demselben Server (siehe roleUrl).
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });

    const setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    for (const [id, handle] of [
      [TENANT_A, "teeladen-a"],
      [TENANT_B, "modeladen-b"],
    ] as const) {
      await setup.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    // Hersteller in Anlagereihenfolge (UUIDv7), einer davon archiviert.
    for (let i = 1; i <= COUNT_A; i++) {
      await setup.query(`INSERT INTO catalog.manufacturer (tenant_id, id, name) VALUES ($1, $2, $3)`, [
        TENANT_A,
        uuidv7(),
        `Teehaus ${i}`,
      ]);
    }
    await setup.query(
      `INSERT INTO catalog.manufacturer (tenant_id, id, name, archived_at, country_code, eu_responsible_name)
       VALUES ($1, $2, 'Alter Hersteller', now(), 'CN', 'EU-Vertretung GmbH')`,
      [TENANT_A, archivedId],
    );
    for (const name of ["Hemdenwerk", "Hosenbau"]) {
      const id = uuidv7();
      idsB.push(id);
      await setup.query(`INSERT INTO catalog.manufacturer (tenant_id, id, name) VALUES ($1, $2, $3)`, [
        TENANT_B,
        id,
        name,
      ]);
    }
    await setup.end();

    appUrl = roleUrl(adminUrl ?? "", dbName, "shop_app");
    database = connectDatabase<unknown>({
      connectionString: appUrl,
      maxConnections: 3,
      applicationName: "api-test",
    });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.destroy();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  const get = (url: string, shop: "a" | "b") =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url, headers: { "x-test-shop": shop } });

  it("die API arbeitet als shop_app ohne Superuser-Rechte, RLS greift", async () => {
    const c = new pg.Client({ connectionString: appUrl });
    await c.connect();
    try {
      const { rows } = await c.query(
        `SELECT current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
                (SELECT count(*)::int FROM catalog.manufacturer) AS visible`,
      );
      expect(rows).toEqual([{ who: "shop_app", su: false, visible: 0 }]);
    } finally {
      await c.end();
    }
  });

  it("jeder Shop sieht nur seine eigenen Hersteller", async () => {
    const a = await get("/admin/v1/manufacturers", "a");
    expect(a.statusCode).toBe(200);
    expect(a.json().data).toHaveLength(COUNT_A);
    expect(a.json().data.every((m: { name: string }) => m.name.startsWith("Teehaus"))).toBe(true);
    const b = await get("/admin/v1/manufacturers", "b");
    expect(b.json().data.map((m: { name: string }) => m.name)).toEqual(["Hemdenwerk", "Hosenbau"]);
  });

  it("T-08: ID aus Shop B ergibt in Shop A 404, genau wie eine erfundene ID", async () => {
    const own = await get(`/admin/v1/manufacturers/${idsB[0]}`, "b");
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ id: idsB[0], name: "Hemdenwerk", version: 1, archivedAt: null });
    const foreign = await get(`/admin/v1/manufacturers/${idsB[0]}`, "a");
    const invented = await get(`/admin/v1/manufacturers/${uuidv7()}`, "a");
    expect(foreign.statusCode).toBe(404);
    expect(invented.statusCode).toBe(404);
    // Die Antworten unterscheiden sich nur in der requestId: keine Spur, dass die ID existiert.
    const strip = (r: typeof foreign) => ({ ...r.json(), requestId: undefined });
    expect(strip(foreign)).toEqual(strip(invented));
    expect(foreign.body).not.toContain("Hemdenwerk");
  });

  it("Cursor: alle Seiten zusammen ergeben jede Zeile genau einmal, in Anlagereihenfolge", async () => {
    const seen: string[] = [];
    let url = "/admin/v1/manufacturers?limit=3";
    for (let page = 0; page < 10; page++) {
      const r = await get(url, "a");
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.data.length).toBeLessThanOrEqual(3);
      seen.push(...body.data.map((m: { name: string }) => m.name));
      if (!body.page.hasMore) {
        expect(body.page.nextCursor).toBeNull();
        break;
      }
      url = `/admin/v1/manufacturers?limit=3&cursor=${body.page.nextCursor}`;
    }
    expect(seen).toEqual(Array.from({ length: COUNT_A }, (_, i) => `Teehaus ${i + 1}`));
  });

  it("archivierte Hersteller fehlen in der Liste, sind aber einzeln lesbar, mit GPSR-Angaben", async () => {
    const list = await get("/admin/v1/manufacturers?limit=100", "a");
    expect(list.json().data.some((m: { name: string }) => m.name === "Alter Hersteller")).toBe(false);
    const one = await get(`/admin/v1/manufacturers/${archivedId}`, "a");
    expect(one.statusCode).toBe(200);
    expect(one.json().archivedAt).toMatch(/Z$/);
    expect(one.json().address.countryCode).toBe("CN");
    expect(one.json().euResponsiblePerson).toEqual({
      name: "EU-Vertretung GmbH",
      address: null,
      email: null,
      phone: null,
    });
  });

  it("kaputter oder fremder Cursor ergibt 422, kein 500", async () => {
    for (const cursor of ["abc", Buffer.from('{"id":"x\' OR 1=1"}').toString("base64url")]) {
      const r = await get(`/admin/v1/manufacturers?cursor=${cursor}`, "a");
      expect(r.statusCode).toBe(422);
      expect(r.json().errors[0].path).toBe("/query/cursor");
    }
  });

  it("ungültige ID ergibt 422 ohne Datenbankfehler", async () => {
    const r = await get("/admin/v1/manufacturers/1;DROP TABLE x", "a");
    expect(r.statusCode).toBe(422);
  });
});
