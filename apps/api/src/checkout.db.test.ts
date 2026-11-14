// MVP-Etappe M6 Ende zu Ende: Warenkorb, Kasse als Gast und Testzahlung über die Storefront-API,
// gegen eine echte Datenbank als shop_app. Prüft Summen, Steuer, Bestand, Bestellnummer, E-Mail,
// doppelte Klicks und dass Tokens nur im eigenen Shop gelten.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutgoingMail } from "@shop/checkout";
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
  if (headers["x-test-shop"] !== "a") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: uuidv7() },
    tenantId: TENANT_A,
    scopes: new Set(["products:read", "products:write"]),
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

describe.skipIf(adminUrl === undefined)("Kaufen als Gast (M6, echte Datenbank)", () => {
  const dbName = `api_checkout_${randomBytes(4).toString("hex")}`;
  const mails: OutgoingMail[] = [];
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
      applicationName: "api-checkout-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        mailer: { send: async (m) => void mails.push(m) },
        storefrontBaseUrl: "https://shop.example.test",
      }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
    });
    for (const [name, price, taxClass, stock] of [
      ["Sencha", 890, "reduced", 5],
      ["Teekanne", 3990, "standard", 1],
    ] as const) {
      const r = await inject(
        "POST",
        "/admin/v1/products",
        { name, price: { amount: price }, taxClass, stock, status: "published" },
        { "x-test-shop": "a" },
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
  let cart = "";
  let payment = "";

  it("legt einen Warenkorb an und rechnet Summen und enthaltene MwSt. je Satz", async () => {
    const created = await inject("POST", `${base}/carts`);
    expect(created.statusCode).toBe(201);
    cart = created.json().token;
    expect(cart).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await inspect.query(`SELECT token_hash FROM cart.cart`);
    expect(rows[0].token_hash.toString("hex")).not.toContain(Buffer.from(cart).toString("hex"));
    await inject("PUT", `${base}/carts/${cart}/lines/${ids["Sencha"]}`, { quantity: 2 });
    const r = await inject("PUT", `${base}/carts/${cart}/lines/${ids["Teekanne"]}`, { quantity: 1 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      count: 3,
      subtotal: 2 * 890 + 3990,
      shipping: 0,
      total: 5770,
      taxByRate: { "7": 116, "19": 637 },
    });
  });

  it("mehr als vorrätig geht nicht (409), 0 nimmt heraus", async () => {
    const tooMany = await inject("PUT", `${base}/carts/${cart}/lines/${ids["Teekanne"]}`, { quantity: 2 });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().detail).toContain("nur noch 1");
    const other = (await inject("POST", `${base}/carts`)).json().token;
    await inject("PUT", `${base}/carts/${other}/lines/${ids["Sencha"]}`, { quantity: 1 });
    const removed = await inject("PUT", `${base}/carts/${other}/lines/${ids["Sencha"]}`, { quantity: 0 });
    expect(removed.json().count).toBe(0);
  });

  it("Token gelten nur im eigenen Shop; erfundene Tokens ergeben 404", async () => {
    expect((await inject("GET", `/store/v1/shops/modeladen/carts/${cart}`)).statusCode).toBe(404);
    expect((await inject("GET", `${base}/carts/${"x".repeat(43)}`)).statusCode).toBe(404);
    expect((await inject("GET", `${base}/carts/zu-kurz`)).statusCode).toBe(422);
  });

  it("bestellen: Bestellnummer, Bestand weg, Warenkorb verbraucht; doppelter Klick bestellt nicht doppelt", async () => {
    const key = randomUUID();
    const body = { email: "kim@example.org", address: ADDRESS };
    const first = await inject("POST", `${base}/carts/${cart}/checkout`, body, { "idempotency-key": key });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ orderNumber: "10001", total: 5770 });
    payment = first.json().paymentToken;
    const again = await inject("POST", `${base}/carts/${cart}/checkout`, body, { "idempotency-key": key });
    expect(again.statusCode).toBe(201);
    expect(again.json().orderNumber).toBe("10001");
    const { rows } = await inspect.query(`SELECT count(*)::int AS n FROM orders."order"`);
    expect(rows[0].n).toBe(1);
    const stock = await inspect.query(
      `SELECT sum(on_hand)::int AS n FROM inventory.stock_level GROUP BY variant_id ORDER BY 1`,
    );
    expect(stock.rows.map((r) => r.n)).toEqual([0, 3]);
    expect((await inject("GET", `${base}/carts/${cart}`)).statusCode).toBe(404);
    expect(
      (await inject("POST", `${base}/carts/${cart}/checkout`, body, { "idempotency-key": randomUUID() }))
        .statusCode,
    ).toBe(404);
    // Ohne Idempotency-Key gibt es keine Bestellung.
    const c2 = (await inject("POST", `${base}/carts`)).json().token;
    await inject("PUT", `${base}/carts/${c2}/lines/${ids["Sencha"]}`, { quantity: 1 });
    expect((await inject("POST", `${base}/carts/${c2}/checkout`, body)).statusCode).toBe(400);
  });

  it("ausverkauft während des Bestellens: 409 und nichts bleibt halb angelegt", async () => {
    const c = (await inject("POST", `${base}/carts`)).json().token;
    await inject("PUT", `${base}/carts/${c}/lines/${ids["Sencha"]}`, { quantity: 3 });
    await inspect.query(`UPDATE inventory.stock_level SET on_hand = 2 WHERE on_hand = 3`);
    const r = await inject(
      "POST",
      `${base}/carts/${c}/checkout`,
      { email: "b@example.org", address: ADDRESS },
      { "idempotency-key": randomUUID() },
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toContain("Sencha");
    const { rows } = await inspect.query(`SELECT count(*)::int AS n FROM orders."order"`);
    expect(rows[0].n).toBe(1);
    expect((await inject("GET", `${base}/carts/${c}`)).statusCode).toBe(200);
  });

  it("Testzahlung: ablehnen, dann bezahlen; Bestellung bezahlt, genau eine E-Mail", async () => {
    const view = await inject("GET", `${base}/test-payments/${payment}`);
    expect(view.json()).toMatchObject({ status: "pending", amount: 5770, order: { orderNumber: "10001" } });
    const declined = await inject("POST", `${base}/test-payments/${payment}`, { outcome: "declined" });
    expect(declined.json()).toMatchObject({ status: "pending", declinedAttempts: 1 });
    expect(mails).toHaveLength(0);
    const paid = await inject("POST", `${base}/test-payments/${payment}`, { outcome: "paid" });
    expect(paid.json()).toMatchObject({
      status: "captured",
      order: { status: "open", paymentStatus: "paid" },
    });
    await inject("POST", `${base}/test-payments/${payment}`, { outcome: "paid" });
    await inject("POST", `${base}/test-payments/${payment}`, { outcome: "declined" });
    expect((await inject("GET", `${base}/test-payments/${payment}`)).json().status).toBe("captured");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "kim@example.org", subject: "teeladen: Deine Bestellung 10001" });
    expect(mails[0]?.text).toContain("2 × Sencha");
    expect(mails[0]?.text).toContain("Summe: 57,70 €");
    // Link zur Bestellstatus-Seite mit dem geheimen Token; die Seite liest dieselbe Zahlung.
    expect(mails[0]?.text).toContain(
      `Stand deiner Bestellung: https://shop.example.test/teeladen/bestellung/${payment}`,
    );
    const status = (await inject("GET", `${base}/test-payments/${payment}`)).json();
    expect(status.order).toMatchObject({ orderNumber: "10001", status: "open", paymentStatus: "paid" });
    expect(new Date(status.order.placedAt).getTime()).toBeGreaterThan(Date.now() - 600_000);
    expect((await inject("GET", `/store/v1/shops/modeladen/test-payments/${payment}`)).statusCode).toBe(404);
  });

  it("zweite Bestellung bekommt die nächste Nummer", async () => {
    const c = (await inject("POST", `${base}/carts`)).json().token;
    await inject("PUT", `${base}/carts/${c}/lines/${ids["Sencha"]}`, { quantity: 1 });
    const r = await inject(
      "POST",
      `${base}/carts/${c}/checkout`,
      { email: "c@example.org", address: ADDRESS },
      { "idempotency-key": randomUUID() },
    );
    expect(r.json().orderNumber).toBe("10002");
  });
});
