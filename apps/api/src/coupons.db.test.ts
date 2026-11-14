// Gutscheincodes Ende zu Ende: anlegen in der Admin-API, einlösen im Warenkorb, Rabatt in Bestellung,
// Steuer je Satz nach Rabatt, Versandgrenze nach Rabatt, abschalten und löschen.
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
        : ["products:read", "products:write", "settings:read", "settings:write", "orders:read"],
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

describe.skipIf(adminUrl === undefined)("Gutscheincodes (echte Datenbank)", () => {
  const dbName = `api_coupons_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  const ids: Record<string, string> = {};

  const inject = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
      applicationName: "api-coupons-test",
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
  type Cart = {
    subtotal: number;
    discount: number;
    shipping: number;
    total: number;
    taxByRate: Record<string, number>;
    couponCode: string | null;
    couponProblem: string | null;
  };
  const cartWith = async (lines: Record<string, number>) => {
    const token = (await inject("POST", `${base}/carts`)).json().token as string;
    let cart = {};
    for (const [name, quantity] of Object.entries(lines))
      cart = (await inject("PUT", `${base}/carts/${token}/lines/${ids[name]}`, { quantity })).json();
    return {
      token,
      cart: cart as Cart,
    };
  };

  it("anlegen: Code in Großbuchstaben, doppelt 409, ungültig 422, nur mit Schreibrecht, Shop B sieht nichts", async () => {
    const made = await inject(
      "POST",
      "/admin/v1/coupons",
      { code: " sommer10 ", kind: "percent", value: 10 },
      asA,
    );
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      code: "SOMMER10",
      kind: "percent",
      value: 10,
      minOrderAmount: null,
      active: true,
    });
    expect(
      (await inject("POST", "/admin/v1/coupons", { code: "Sommer10", kind: "amount", value: 1 }, asA))
        .statusCode,
    ).toBe(409);
    const bad = await inject("POST", "/admin/v1/coupons", { code: "<b>", kind: "percent", value: 10 }, asA);
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].path).toBe("/body/code");
    expect(
      (await inject("POST", "/admin/v1/coupons", { code: "ZUVIEL", kind: "percent", value: 150 }, asA))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await inject(
          "POST",
          "/admin/v1/coupons",
          { code: "X1", kind: "percent", value: 5 },
          { "x-test-shop": "a-lesen" },
        )
      ).statusCode,
    ).toBe(403);
    await inject(
      "POST",
      "/admin/v1/coupons",
      { code: "FEST5", kind: "amount", value: 500, minOrderAmount: 3000 },
      asA,
    );
    const list = (await inject("GET", "/admin/v1/coupons", undefined, asA)).json().data;
    expect(list.map((c: { code: string }) => c.code)).toEqual(["FEST5", "SOMMER10"]);
    expect((await inject("GET", "/admin/v1/coupons", undefined, { "x-test-shop": "b" })).json().data).toEqual(
      [],
    );
  });

  it("einlösen: Rabatt, Steuer nach Rabatt, Versandgrenze nach Rabatt, Mindestwert und unbekannt 422", async () => {
    await inject("PUT", "/admin/v1/shipping", { amount: 490, freeFrom: 4000 }, asA);
    const { token, cart } = await cartWith({ Sencha: 1, Teekanne: 1 });
    expect(cart).toMatchObject({ subtotal: 4000, discount: 0, shipping: 0, total: 4000, couponCode: null });
    const r = await inject("PUT", `${base}/carts/${token}/coupon`, { code: "sommer10" });
    expect(r.statusCode).toBe(200);
    // 10 % von 40 € = 4 €; Warenwert danach 36 € < 40 € → Versand 4,90 €.
    expect(r.json()).toMatchObject({
      subtotal: 4000,
      discount: 400,
      shipping: 490,
      total: 4090,
      couponCode: "SOMMER10",
    });
    // Sencha 9,00 € zu 7 % = 0,59 €; Teekanne 27,00 € zu 19 % = 4,31 €; Versand 4,90 € zu 19 % = 0,78 €.
    expect(r.json().taxByRate).toEqual({ "7": 59, "19": 431 + 78 });
    const min = await inject("PUT", `${base}/carts/${(await cartWith({ Sencha: 1 })).token}/coupon`, {
      code: "FEST5",
    });
    expect(min.statusCode).toBe(422);
    expect(min.json().errors[0].message.replace(/\s/g, " ")).toBe(
      "Dieser Gutschein gilt ab 30,00 € Warenwert.",
    );
    expect((await inject("PUT", `${base}/carts/${token}/coupon`, { code: "GIBTSNICHT" })).statusCode).toBe(
      422,
    );
    // Der gültige Code bleibt nach dem Fehlversuch erhalten.
    expect((await inject("GET", `${base}/carts/${token}`)).json().couponCode).toBe("SOMMER10");
    const placed = await inject(
      "POST",
      `${base}/carts/${token}/checkout`,
      { email: "kim@example.org", address: ADDRESS },
      { "idempotency-key": randomUUID() },
    );
    expect(placed.statusCode).toBe(201);
    expect(placed.json().total).toBe(4090);
    const row = await inspect.query(
      `SELECT subtotal_amount::int AS sub, discount_amount::int AS disc, shipping_amount::int AS ship,
              total_amount::int AS total, tax_amount::int AS tax, custom_fields->>'couponCode' AS code,
              (SELECT sum(discount_amount)::int FROM orders.order_line l WHERE l.order_id = o.id) AS line_disc
         FROM orders."order" o WHERE tenant_id = $1`,
      [TENANT_A],
    );
    expect(row.rows[0]).toEqual({
      sub: 4000,
      disc: 400,
      ship: 490,
      total: 4090,
      tax: 59 + 431 + 78,
      code: "SOMMER10",
      line_disc: 400,
    });
    const id = (await inject("GET", "/admin/v1/orders", undefined, asA)).json().data[0].id;
    expect((await inject("GET", `/admin/v1/orders/${id}`, undefined, asA)).json()).toMatchObject({
      discount: 400,
      couponCode: "SOMMER10",
      total: 4090,
    });
  });

  it("abgeschaltet gilt nicht mehr (Hinweis im Warenkorb); löschen", async () => {
    const { token } = await cartWith({ Teekanne: 2 });
    await inject("PUT", `${base}/carts/${token}/coupon`, { code: "SOMMER10" });
    const sommer = (await inject("GET", "/admin/v1/coupons", undefined, asA))
      .json()
      .data.find((c: { code: string }) => c.code === "SOMMER10");
    expect(
      (await inject("PATCH", `/admin/v1/coupons/${sommer.id}`, { active: false }, asA)).json().active,
    ).toBe(false);
    const cart = (await inject("GET", `${base}/carts/${token}`)).json();
    expect(cart).toMatchObject({ discount: 0, total: 6000, couponCode: null });
    expect(cart.couponProblem).toContain("gilt nicht mehr");
    const removed = (await inject("DELETE", `${base}/carts/${token}/coupon`)).json();
    expect(removed.couponProblem).toBeNull();
    expect((await inject("DELETE", `/admin/v1/coupons/${sommer.id}`, undefined, asA)).statusCode).toBe(200);
    expect((await inject("DELETE", `/admin/v1/coupons/${sommer.id}`, undefined, asA)).statusCode).toBe(404);
    expect(
      (await inject("PATCH", `/admin/v1/coupons/${sommer.id}`, { active: true }, { "x-test-shop": "b" }))
        .statusCode,
    ).toBe(404);
  });
});
