// Analytics Ende zu Ende (Paket P3): Seitenaufrufe melden (Storefront-API, öffentlich) und im
// Backoffice auswerten (Admin-API), gegen eine echte Datenbank als shop_app. Geprüft wird auch,
// dass ein Shop die Zahlen des anderen nicht sieht.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createMedia, memoryStorage } from "@shop/media";
import { createShopDirectory } from "@shop/platform";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints } from "./endpoints.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();

const resolver: ActorResolver = async ({ headers }) => {
  const shop = headers["x-test-shop"];
  if (shop !== "a" && shop !== "b") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: uuidv7() },
    tenantId: shop === "a" ? TENANT_A : TENANT_B,
    // Beide dürfen lesen; geprüft wird die Trennung der Zahlen, nicht die Rechte.
    scopes: new Set(["orders:read", "settings:read"]),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Analytics: Seitenaufrufe (echte Datenbank)", () => {
  const dbName = `api_analytics_${randomBytes(4).toString("hex")}`;
  const storage = memoryStorage();
  let admin: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    const setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    for (const [id, handle] of [
      [TENANT_A, "stats-a"],
      [TENANT_B, "stats-b"],
    ] as const) {
      await setup.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    await setup.end();
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "api-analytics-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        media: createMedia({ database, storage, publicBaseUrl: "https://media.localhost" }),
      }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
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

  function call(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    shop?: "a" | "b",
    payload?: object,
    version?: number,
  ) {
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: {
          ...(shop === undefined ? {} : { "x-test-shop": shop }),
          ...(version === undefined ? {} : { "if-match": `"${version}"` }),
        },
        ...(payload === undefined ? {} : { payload }),
      });
  }

  const meldung = (shop: string, entries: object[]) =>
    call("POST", `/store/v1/shops/${shop}/views`, undefined, { entries });

  it("zählt gemeldete Aufrufe und wertet sie aus", async () => {
    expect((await meldung("stats-a", [{ path: "/", kind: "start", count: 3 }])).statusCode).toBe(201);
    expect(
      (
        await meldung("stats-a", [
          { path: "/produkt/sencha", kind: "produkt", count: 2 },
          { path: "/", kind: "start", count: 1 },
        ])
      ).statusCode,
    ).toBe(201);

    const r = await call("GET", "/admin/v1/analytics/views?days=7", "a");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // Vier Aufrufe der Startseite, zwei des Produkts.
    expect(body.total).toBe(6);
    expect(body.pages).toEqual([
      { path: "/", kind: "start", views: 4 },
      { path: "/produkt/sencha", kind: "produkt", views: 2 },
    ]);
    // Ein Eintrag je Tag, auch für Tage ohne Aufruf; der letzte ist heute.
    expect(body.days).toHaveLength(7);
    expect(body.days[6].views).toBe(6);
    expect(body.days[0].views).toBe(0);
  });

  it("hält die Shops auseinander", async () => {
    expect((await meldung("stats-b", [{ path: "/", kind: "start", count: 5 }])).statusCode).toBe(201);
    expect((await call("GET", "/admin/v1/analytics/views?days=7", "a")).json().total).toBe(6);
    expect((await call("GET", "/admin/v1/analytics/views?days=7", "b")).json().total).toBe(5);
  });

  it("fasst den Pfad zusammen und weist Unsinn ab", async () => {
    // Sortierung und Schrägstrich am Ende sind dieselbe Seite.
    await meldung("stats-a", [{ path: "/produkte?sortierung=preis", kind: "sonstige", count: 1 }]);
    await meldung("stats-a", [{ path: "/produkte/", kind: "sonstige", count: 1 }]);
    const seiten = (await call("GET", "/admin/v1/analytics/views?days=7", "a")).json().pages;
    expect(seiten.find((p: { path: string }) => p.path === "/produkte")?.views).toBe(2);

    expect((await meldung("stats-a", [])).statusCode).toBe(422);
    expect((await meldung("stats-a", [{ path: "/", kind: "quatsch", count: 1 }])).statusCode).toBe(422);
    expect((await meldung("stats-a", [{ path: "/", kind: "start", count: 0 }])).statusCode).toBe(422);
    expect((await call("GET", "/admin/v1/analytics/views?days=0", "a")).statusCode).toBe(422);
  });

  it("gibt es den Shop nicht, zählt auch nichts", async () => {
    expect((await meldung("gibt-es-nicht", [{ path: "/", kind: "start", count: 1 }])).statusCode).toBe(404);
  });
});
