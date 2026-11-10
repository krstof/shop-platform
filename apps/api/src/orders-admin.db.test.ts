// MVP-Etappe M7: Bestellungen im Backoffice über die Admin-API, gegen eine echte Datenbank.
// Eine Bestellung entsteht über den echten Kaufweg der Storefront-API (M6).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor, Scope } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
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

const TENANT = uuidv7();
const SCOPES: Record<string, Scope[]> = {
  owner: ["products:read", "products:write", "orders:read", "orders:write"],
  reader: ["orders:read"],
};

const resolver: ActorResolver = async ({ headers }) => {
  const who = headers["x-test-user"];
  if (typeof who !== "string" || !(who in SCOPES)) return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: uuidv7() },
    tenantId: TENANT,
    scopes: new Set(SCOPES[who]),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Bestellungen im Backoffice (M7, echte Datenbank)", () => {
  const dbName = `api_orders_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;

  const inject = (method: "GET" | "POST" | "PUT", url: string, who?: string, payload?: object, extra = {}) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { ...(who === undefined ? {} : { "x-test-user": who }), ...extra },
        ...(payload === undefined ? {} : { payload }),
      });

  /** Kauft über die Storefront-API ein und zahlt (oder nicht). */
  async function buy(quantity: number, pay: boolean): Promise<string> {
    const base = "/store/v1/shops/laden";
    const cart = (await inject("POST", `${base}/carts`)).json().token;
    const products = (await inject("GET", `${base}/products`)).json().data;
    await inject("PUT", `${base}/carts/${cart}/lines/${products[0].id}`, undefined, { quantity });
    const r = await inject(
      "POST",
      `${base}/carts/${cart}/checkout`,
      undefined,
      {
        email: "kim@example.org",
        address: {
          firstName: "Kim",
          lastName: "Muster",
          street: "Teeweg 1",
          postalCode: "20095",
          city: "Hamburg",
        },
      },
      { "idempotency-key": randomUUID() },
    );
    if (pay)
      await inject("POST", `${base}/test-payments/${r.json().paymentToken}`, undefined, { outcome: "paid" });
    return r.json().orderNumber;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    const setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    await setup.query(
      `WITH m AS (INSERT INTO platform.merchant (name) VALUES ('laden') RETURNING id)
       INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
       SELECT $1, m.id, p.id, 'laden', 'Laden', 'active' FROM m, platform.plan p WHERE p.is_default`,
      [TENANT],
    );
    await setup.end();
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 4,
      applicationName: "api-orders-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
    });
    await inject("POST", "/admin/v1/products", "owner", {
      name: "Sencha",
      price: { amount: 890 },
      taxClass: "reduced",
      stock: 50,
      status: "published",
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

  it("listet Bestellungen, neueste zuerst, mit Kundin, Summe und Status; seitenweise", async () => {
    await buy(2, true);
    await buy(1, false);
    await buy(3, true);
    const page1 = (await inject("GET", "/admin/v1/orders?limit=2", "reader")).json();
    expect(page1.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(["10003", "10002"]);
    expect(page1.data[0]).toMatchObject({
      customerName: "Kim Muster",
      email: "kim@example.org",
      total: 2670,
      itemCount: 3,
      status: "open",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
    });
    expect(page1.data[1]).toMatchObject({ status: "pending_payment", paymentStatus: "unpaid" });
    const page2 = (
      await inject("GET", `/admin/v1/orders?limit=2&cursor=${page1.page.nextCursor}`, "reader")
    ).json();
    expect(page2.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(["10001"]);
  });

  it("zeigt Details und markiert nur bezahlte Bestellungen als versendet", async () => {
    const list = (await inject("GET", "/admin/v1/orders", "reader")).json().data;
    const paid = list.find((o: { orderNumber: string }) => o.orderNumber === "10001");
    const unpaid = list.find((o: { orderNumber: string }) => o.orderNumber === "10002");
    const detail = (await inject("GET", `/admin/v1/orders/${paid.id}`, "reader")).json();
    expect(detail).toMatchObject({
      address: { street: "Teeweg 1", postalCode: "20095", city: "Hamburg" },
      lines: [{ name: "Sencha", quantity: 2, unitPrice: 890, lineTotal: 1780, taxRatePercent: 7 }],
      taxByRate: { "7": 116 },
      paymentMethodName: "Testzahlung",
    });
    expect((await inject("POST", `/admin/v1/orders/${paid.id}/ship`, "reader")).statusCode).toBe(403);
    const shipped = await inject("POST", `/admin/v1/orders/${paid.id}/ship`, "owner");
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json()).toMatchObject({ status: "completed", fulfillmentStatus: "shipped" });
    expect((await inject("POST", `/admin/v1/orders/${paid.id}/ship`, "owner")).statusCode).toBe(409);
    expect((await inject("POST", `/admin/v1/orders/${unpaid.id}/ship`, "owner")).statusCode).toBe(409);
    expect((await inject("GET", `/admin/v1/orders/${uuidv7()}`, "reader")).statusCode).toBe(404);
  });
});
