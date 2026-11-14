// Versandkosten Ende zu Ende: einstellen in der Admin-API, lesen in der Storefront-API, Warenkorb
// und Bestellung rechnen sie mit (Pauschale, kostenlos ab Warenwert, MwSt. auf den Versand).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
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

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();

const resolver: ActorResolver = async ({ headers }) => {
  const shop = headers["x-test-shop"];
  if (shop !== "a" && shop !== "b" && shop !== "a-lesen") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: uuidv7() },
    tenantId: shop === "b" ? TENANT_B : TENANT_A,
    scopes: new Set(
      shop === "a-lesen"
        ? ["settings:read"]
        : ["products:read", "products:write", "settings:read", "settings:write"],
    ),
  };
  return auth;
};

const ADDRESS = {
  firstName: "Kim",
  lastName: "Muster",
  street: "Teeweg 1",
  postalCode: "20095",
  city: "Hamburg",
};

describe.skipIf(adminUrl === undefined)("Versandkosten (echte Datenbank)", () => {
  const dbName = `api_shipping_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  const ids: Record<string, string> = {};

  const inject = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  const asA = { "x-test-shop": "a" };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    inspect = new pg.Client({ connectionString: setupUrl.href });
    await inspect.connect();
    for (const [id, handle] of [
      [TENANT_A, "teeladen"],
      [TENANT_B, "modeladen"],
    ] as const) {
      await inspect.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 4,
      applicationName: "api-shipping-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
    });
    for (const [name, price, taxClass] of [
      ["Sencha", 1000, "reduced"],
      ["Teekanne", 3000, "standard"],
    ] as const) {
      const r = await inject(
        "POST",
        "/admin/v1/products",
        { name, price: { amount: price }, taxClass, stock: 20, status: "published" },
        asA,
      );
      ids[name] = r.json().id;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.destroy();
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  const base = "/store/v1/shops/teeladen";
  const cartWith = async (lines: Record<string, number>) => {
    const token = (await inject("POST", `${base}/carts`)).json().token as string;
    let cart = {};
    for (const [name, quantity] of Object.entries(lines))
      cart = (await inject("PUT", `${base}/carts/${token}/lines/${ids[name]}`, { quantity })).json();
    return {
      token,
      cart: cart as { subtotal: number; shipping: number; total: number; taxByRate: Record<string, number> },
    };
  };

  it("ohne Einstellung kostenlos; einstellen, lesen, Prüfungen, Rechte, Shop B bleibt kostenlos", async () => {
    expect((await inject("GET", "/admin/v1/shipping", undefined, asA)).json()).toEqual({
      amount: 0,
      freeFrom: null,
      currency: "EUR",
    });
    expect((await cartWith({ Sencha: 1 })).cart).toMatchObject({ shipping: 0, total: 1000 });
    const bad = await inject("PUT", "/admin/v1/shipping", { amount: 0, freeFrom: 5000 }, asA);
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].path).toBe("/body/freeFrom");
    expect((await inject("PUT", "/admin/v1/shipping", { amount: -1, freeFrom: null }, asA)).statusCode).toBe(
      422,
    );
    expect(
      (
        await inject(
          "PUT",
          "/admin/v1/shipping",
          { amount: 490, freeFrom: 5000 },
          { "x-test-shop": "a-lesen" },
        )
      ).statusCode,
    ).toBe(403);
    const ok = await inject("PUT", "/admin/v1/shipping", { amount: 490, freeFrom: 5000 }, asA);
    expect(ok.json()).toEqual({ amount: 490, freeFrom: 5000, currency: "EUR" });
    // Zweimal speichern ändert nur die Werte (keine zweite Versandart).
    await inject("PUT", "/admin/v1/shipping", { amount: 490, freeFrom: 5000 }, asA);
    const { rows } = await inspect.query(
      `SELECT count(*)::int AS n FROM shipping.shipping_rate WHERE tenant_id = $1`,
      [TENANT_A],
    );
    expect(rows[0].n).toBe(1);
    expect((await inject("GET", `${base}/shipping`)).json()).toEqual({
      amount: 490,
      freeFrom: 5000,
      currency: "EUR",
    });
    expect((await inject("GET", "/store/v1/shops/modeladen/shipping")).json().amount).toBe(0);
    expect((await inject("GET", "/admin/v1/shipping", undefined, { "x-test-shop": "b" })).json().amount).toBe(
      0,
    );
  });

  it("Warenkorb und Bestellung rechnen Versand mit; MwSt. auf den Versand zum Satz des größten Warenwerts", async () => {
    // 1× Sencha (7 %, 10 €) + 1× Teekanne (19 %, 30 €) = 40 € < 50 € → 4,90 € Versand zu 19 %.
    const { token, cart } = await cartWith({ Sencha: 1, Teekanne: 1 });
    expect(cart).toMatchObject({ subtotal: 4000, shipping: 490, total: 4490 });
    // 19 % aus 30,00 € = 4,79 €, aus 4,90 € = 0,78 €; 7 % aus 10,00 € = 0,65 €.
    expect(cart.taxByRate).toEqual({ "7": 65, "19": 479 + 78 });
    const placed = await inject(
      "POST",
      `${base}/carts/${token}/checkout`,
      { email: "kim@example.org", address: ADDRESS },
      { "idempotency-key": randomUUID() },
    );
    expect(placed.statusCode).toBe(201);
    expect(placed.json().total).toBe(4490);
    const order = await inspect.query(
      `SELECT subtotal_amount::int AS sub, shipping_amount::int AS ship, total_amount::int AS total,
              tax_amount::int AS tax, shipping_method_name AS name
         FROM orders."order" WHERE tenant_id = $1`,
      [TENANT_A],
    );
    expect(order.rows[0]).toEqual({
      sub: 4000,
      ship: 490,
      total: 4490,
      tax: 65 + 479 + 78,
      name: "Standardversand",
    });
    const lines = await inspect.query(
      `SELECT rate_bp, (taxable_amount + tax_amount)::int AS gross FROM orders.order_tax_line
        WHERE tenant_id = $1 ORDER BY rate_bp`,
      [TENANT_A],
    );
    expect(lines.rows).toEqual([
      { rate_bp: 700, gross: 1000 },
      { rate_bp: 1900, gross: 3490 },
    ]);
  });

  it("ab der Grenze kostenlos; Pauschale 0 macht alles kostenlos", async () => {
    expect((await cartWith({ Sencha: 2, Teekanne: 1 })).cart).toMatchObject({
      subtotal: 5000,
      shipping: 0,
      total: 5000,
    });
    await inject("PUT", "/admin/v1/shipping", { amount: 0, freeFrom: null }, asA);
    expect((await cartWith({ Sencha: 1 })).cart).toMatchObject({ shipping: 0, total: 1000 });
  });
});
