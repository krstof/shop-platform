// Bestseller der Storefront: meistverkaufte Produkte der letzten 90 Tage, ohne stornierte und
// unbezahlte Bestellungen, nur aus dem eigenen Shop.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createShopDirectory } from "@shop/platform";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe.skipIf(adminUrl === undefined)("Bestseller (echte Datenbank)", () => {
  const dbName = `api_bestseller_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  const P1 = uuidv7();
  const P2 = uuidv7();
  const P3 = uuidv7();
  const P4 = uuidv7();

  const get = (url: string) => app.getHttpAdapter().getInstance().inject({ method: "GET", url });

  async function order(
    tenantId: string,
    status: string,
    lines: readonly (readonly [string, number])[],
    daysAgo = 1,
  ) {
    const { rows } = await inspect.query<{ id: string }>(
      `WITH c AS (INSERT INTO shop_settings.sales_channel (tenant_id, code, kind, name)
                  VALUES ($1, $2, 'storefront', 'Test') RETURNING id)
       INSERT INTO orders."order" (tenant_id, order_number, channel_id, email, locale, currency, tax_display,
                                   subtotal_amount, tax_amount, total_amount, status, payment_status, placed_at)
       SELECT $1, $2, c.id, 'k@example.org', 'de', 'EUR', 'gross', 100, 0, 100, $3,
              CASE WHEN $3 = 'pending_payment' THEN 'unpaid' ELSE 'paid' END,
              now() - make_interval(days => $4) FROM c
       RETURNING id`,
      [tenantId, `b-${randomBytes(4).toString("hex")}`, status, daysAgo],
    );
    const orderId = rows[0]?.id;
    let position = 1;
    for (const [productId, quantity] of lines) {
      await inspect.query(
        `INSERT INTO orders.order_line (tenant_id, order_id, position, product_id, variant_id, product_name,
            quantity, unit_price_amount, unit_price_includes_tax, line_subtotal_amount, tax_class_code,
            tax_rate_bp, vat_category_code, tax_amount, line_total_amount)
         VALUES ($1, $2, $3, $4, $4, 'Tee', $5, 100, true, 100, 'standard', 1900, 'S', 0, 100)`,
        [tenantId, orderId, position++, productId, quantity],
      );
    }
  }

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
      applicationName: "api-bestseller-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: async () => undefined,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
    });
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

  it("zählt Stückzahlen bezahlter Bestellungen der letzten 90 Tage, nur im eigenen Shop", async () => {
    expect((await get("/store/v1/shops/teeladen/bestsellers")).json()).toEqual({ productIds: [] });

    await order(TENANT_A, "open", [
      [P1, 1],
      [P2, 3],
    ]);
    await order(TENANT_A, "completed", [[P1, 1]]);
    await order(TENANT_A, "in_progress", [[P3, 1]]);
    // Zählen nicht: storniert, unbezahlt, zu alt, anderer Shop.
    await order(TENANT_A, "cancelled", [[P4, 50]]);
    await order(TENANT_A, "pending_payment", [[P4, 50]]);
    await order(TENANT_A, "completed", [[P4, 50]], 120);
    await order(TENANT_B, "completed", [[P4, 99]]);

    const res = await get("/store/v1/shops/teeladen/bestsellers");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ productIds: [P2, P1, P3] });
    expect((await get("/store/v1/shops/modeladen/bestsellers")).json()).toEqual({ productIds: [P4] });
    expect((await get("/store/v1/shops/gibtsnicht/bestsellers")).statusCode).toBe(404);
  });
});
