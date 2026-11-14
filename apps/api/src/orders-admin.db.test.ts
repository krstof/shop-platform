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
  owner: ["products:read", "products:write", "orders:read", "orders:write", "customers:read"],
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
  async function buy(
    quantity: number,
    pay: boolean,
    who = { email: "kim@example.org", firstName: "Kim", lastName: "Muster" },
  ): Promise<string> {
    const base = "/store/v1/shops/laden";
    const cart = (await inject("POST", `${base}/carts`)).json().token;
    const products = (await inject("GET", `${base}/products`)).json().data;
    await inject("PUT", `${base}/carts/${cart}/lines/${products[0].id}`, undefined, { quantity });
    const r = await inject(
      "POST",
      `${base}/carts/${cart}/checkout`,
      undefined,
      {
        email: who.email,
        address: {
          firstName: who.firstName,
          lastName: who.lastName,
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

  it("filtert nach Stand und sucht in Bestellnummer, Name und E-Mail", async () => {
    // Bisher: 10001 versendet, 10002 wartet auf Zahlung, 10003 bezahlt (alle Kim Muster).
    await buy(1, true, { email: "jo.weber@example.net", firstName: "Jo", lastName: "Weber_100%" });
    const numbers = async (query: string) => {
      const r = await inject("GET", `/admin/v1/orders?${query}`, "reader");
      expect(r.statusCode).toBe(200);
      return r.json().data.map((o: { orderNumber: string }) => o.orderNumber);
    };
    expect(await numbers("status=pending_payment")).toEqual(["10002"]);
    expect(await numbers("status=open")).toEqual(["10004", "10003"]);
    expect(await numbers("status=completed")).toEqual(["10001"]);
    expect(await numbers("q=10003")).toEqual(["10003"]);
    expect(await numbers("q=kim%20MUSTER")).toEqual(["10003", "10002", "10001"]);
    expect(await numbers("q=example.net")).toEqual(["10004"]);
    expect(await numbers("q=weber")).toEqual(["10004"]);
    // % und _ zählen als normale Zeichen, nicht als Platzhalter.
    expect(await numbers("q=_100%25")).toEqual(["10004"]);
    expect(await numbers("q=%25")).toEqual(["10004"]);
    expect(await numbers("q=kim&status=open")).toEqual(["10003"]);
    expect(await numbers("q=niemand")).toEqual([]);
    // Seitenweise mit Filter.
    const p1 = (await inject("GET", "/admin/v1/orders?q=kim&limit=1", "reader")).json();
    const p2 = (
      await inject("GET", `/admin/v1/orders?q=kim&limit=1&cursor=${p1.page.nextCursor}`, "reader")
    ).json();
    expect(p2.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(["10002"]);
    for (const bad of ["status=bezahlt", "q=", `q=${"x".repeat(101)}`]) {
      expect((await inject("GET", `/admin/v1/orders?${bad}`, "reader")).statusCode).toBe(422);
    }
  });

  it("liefert Kennzahlen: Umsatz heute aus bezahlten Bestellungen, zu versenden, wartet auf Zahlung", async () => {
    // Bisher: 10001 bezahlt und versendet (17,80 €), 10002 unbezahlt, 10003 bezahlt (26,70 €), 10004 bezahlt (8,90 €).
    const r = await inject("GET", "/admin/v1/orders/summary", "reader");
    expect(r.statusCode).toBe(200);
    const stats = r.json();
    expect(stats).toMatchObject({ currency: "EUR", toShip: 2, awaitingPayment: 1 });
    expect(stats.days).toHaveLength(7);
    expect(stats.days.at(-1)).toMatchObject({ orders: 3, revenue: 5340 });
    expect(stats.days.slice(0, 6).every((d: { orders: number }) => d.orders === 0)).toBe(true);
    // Ohne Leserecht für Bestellungen nichts.
    expect((await inject("GET", "/admin/v1/orders/summary")).statusCode).toBe(401);
  });
  it("storniert: Ware zurück ins Lager, bezahlt gilt als erstattet; versendet oder schon storniert 409", async () => {
    const stock = async () =>
      (await inject("GET", "/admin/v1/products", "owner")).json().data[0].stock as number;
    const before = await stock();
    const paidNumber = await buy(4, true);
    const unpaidNumber = await buy(2, false);
    expect(await stock()).toBe(before - 6);
    const byNumber = async (n: string) =>
      (await inject("GET", `/admin/v1/orders?q=${n}`, "reader")).json().data[0].id as string;
    const paid = await byNumber(paidNumber);
    expect((await inject("POST", `/admin/v1/orders/${paid}/cancel`, "reader")).statusCode).toBe(403);
    const r = await inject("POST", `/admin/v1/orders/${paid}/cancel`, "owner");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      fulfillmentStatus: "unfulfilled",
    });
    expect(await stock()).toBe(before - 2);
    const unpaid = await byNumber(unpaidNumber);
    expect((await inject("POST", `/admin/v1/orders/${unpaid}/cancel`, "owner")).json()).toMatchObject({
      status: "cancelled",
      paymentStatus: "unpaid",
    });
    expect(await stock()).toBe(before);
    expect((await inject("POST", `/admin/v1/orders/${paid}/cancel`, "owner")).statusCode).toBe(409);
    expect((await inject("POST", `/admin/v1/orders/${paid}/ship`, "owner")).statusCode).toBe(409);
    // Versendete Bestellung (10001) lässt sich nicht stornieren; unbekannte 404.
    expect(
      (await inject("POST", `/admin/v1/orders/${await byNumber("10001")}/cancel`, "owner")).statusCode,
    ).toBe(409);
    expect((await inject("POST", `/admin/v1/orders/${uuidv7()}/cancel`, "owner")).statusCode).toBe(404);
    // Stornierte zählen nicht als „wartet auf Zahlung“ oder „zu versenden“ und nicht zum Umsatz.
    const stats = (await inject("GET", "/admin/v1/orders/summary", "reader")).json();
    expect(stats).toMatchObject({ toShip: 2, awaitingPayment: 1 });
    expect(stats.days.at(-1)).toMatchObject({ revenue: 5340 });
  });
  it("interne Notiz setzen und löschen; Leserecht reicht nicht; unbekannt 404", async () => {
    const id = (await inject("GET", "/admin/v1/orders", "reader")).json().data[0].id as string;
    expect((await inject("GET", `/admin/v1/orders/${id}`, "reader")).json()).toMatchObject({
      customerNote: null,
      merchantNote: null,
    });
    const url = `/admin/v1/orders/${id}/note`;
    expect((await inject("PUT", url, "reader", { note: "x" })).statusCode).toBe(403);
    const set = await inject("PUT", url, "owner", { note: "Als Geschenk verpacken.\nDanke!" });
    expect(set.statusCode).toBe(200);
    expect(set.json().merchantNote).toBe("Als Geschenk verpacken.\nDanke!");
    expect((await inject("PUT", url, "owner", { note: null })).json().merchantNote).toBeNull();
    expect((await inject("PUT", url, "owner", { note: "   " })).statusCode).toBe(422);
    expect((await inject("PUT", url, "owner", { note: "x".repeat(2001) })).statusCode).toBe(422);
    expect(
      (await inject("PUT", `/admin/v1/orders/${uuidv7()}/note`, "owner", { note: null })).statusCode,
    ).toBe(404);
  });
  it("Kundenliste: je E-Mail zusammengefasst, Zahlen passen zur Bestellliste, nur mit Kundenrecht", async () => {
    expect((await inject("GET", "/admin/v1/customers", "reader")).statusCode).toBe(403);
    const r = await inject("GET", "/admin/v1/customers", "owner");
    expect(r.statusCode).toBe(200);
    const customers = r.json().data as { email: string; name: string; orderCount: number; revenue: number }[];
    const orders = (await inject("GET", "/admin/v1/orders?limit=100", "reader")).json().data as {
      email: string;
      total: number;
      status: string;
      paymentStatus: string;
    }[];
    for (const c of customers) {
      const mine = orders.filter((o) => o.email.toLowerCase() === c.email.toLowerCase());
      expect(c.orderCount).toBe(mine.filter((o) => o.status !== "cancelled").length);
      expect(c.revenue).toBe(mine.filter((o) => o.paymentStatus === "paid").reduce((a, o) => a + o.total, 0));
    }
    expect(new Set(customers.map((c) => c.email.toLowerCase())).size).toBe(customers.length);
    expect(customers.find((c) => c.email === "kim@example.org")?.name).toBe("Kim Muster");
  });
});
