// MVP-Etappe M2 Ende zu Ende: Kategorien und Produkte mit Preis und Bestand über die Admin-API,
// gegen eine echte Datenbank als shop_app. Preis (pricing) und Bestand (inventory) laufen in
// derselben Transaktion wie das Produkt: Scheitert etwas, bleibt nichts halb angelegt.
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
import { databaseIdempotencyStore } from "./idempotency-store.js";
import { SEED_CATALOG, seedCatalog } from "./seed-catalog.js";

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
    scopes: new Set(["products:read", "products:write"]),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Produkte und Kategorien (M2, echte Datenbank)", () => {
  const dbName = `api_products_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;

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
      [TENANT_A, "teeladen-a"],
      [TENANT_B, "modeladen-b"],
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
      maxConnections: 3,
      applicationName: "api-products-test",
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
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  const call = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    shop: "a" | "b",
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { "x-test-shop": shop, ...headers },
        ...(payload === undefined ? {} : { payload }),
      });

  let categoryId = "";
  let productId = "";

  it("legt eine Kategorie an, die Adresse entsteht aus dem Namen", async () => {
    const r = await call("POST", "/admin/v1/categories", "a", { name: "Grüntee", description: "Frisch." });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      name: "Grüntee",
      slug: "gruentee",
      description: "Frisch.",
      visible: true,
    });
    categoryId = r.json().id;
    const twin = await call("POST", "/admin/v1/categories", "a", { name: "Grüntee" });
    expect(twin.json().slug).toBe("gruentee-2");
    const taken = await call("POST", "/admin/v1/categories", "a", { name: "X", slug: "gruentee" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().errors[0].code).toBe("slug_taken");
  });

  it("legt ein Produkt mit Preis, Steuersatz, Bestand und Kategorie an", async () => {
    const r = await call("POST", "/admin/v1/products", "a", {
      name: "Sencha Frühlingshauch",
      description: "Erster Absatz.\n\nZweiter Absatz.",
      price: { amount: 890, currency: "EUR" },
      taxClass: "reduced",
      stock: 25,
      categoryId,
      status: "published",
    });
    expect(r.statusCode).toBe(201);
    expect(r.headers["etag"]).toBe('"1"');
    const p = r.json();
    expect(p).toMatchObject({
      name: "Sencha Frühlingshauch",
      slug: "sencha-fruehlingshauch",
      description: "Erster Absatz.\n\nZweiter Absatz.",
      price: { amount: 890, currency: "EUR" },
      taxClass: "reduced",
      stock: 25,
      categoryId,
      status: "published",
      sku: null,
    });
    expect(p.publishedAt).not.toBeNull();
    productId = p.id;
    // Gespeichert in den Tabellen der drei Module, Ereignis in der Outbox.
    const { rows } = await inspect.query(
      `SELECT (SELECT amount FROM pricing.price WHERE tenant_id = $1) AS amount,
              (SELECT on_hand FROM inventory.stock_level WHERE tenant_id = $1) AS on_hand,
              (SELECT count(*)::int FROM inventory.stock_movement WHERE tenant_id = $1 AND reason = 'initial') AS moves,
              (SELECT count(*)::int FROM kernel.outbox WHERE tenant_id = $1 AND type = 'catalog.product.created.v1') AS events`,
      [TENANT_A],
    );
    expect(rows[0]).toEqual({ amount: "890", on_hand: 25, moves: 1, events: 1 });
  });

  it("ändert Preis und Bestand mit If-Match; Verlauf und Ereignis nennen die Änderung", async () => {
    const url = `/admin/v1/products/${productId}`;
    const ok = await call("PATCH", url, "a", { price: { amount: 950 }, stock: 40 }, { "if-match": '"1"' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["etag"]).toBe('"2"');
    expect(ok.json()).toMatchObject({ price: { amount: 950 }, stock: 40 });
    const stale = await call("PATCH", url, "a", { stock: 1 }, { "if-match": '"1"' });
    expect(stale.statusCode).toBe(412);
    const { rows } = await inspect.query(
      `SELECT (SELECT count(*)::int FROM pricing.price_history WHERE tenant_id = $1) AS history,
              (SELECT data->'changes' FROM kernel.outbox WHERE tenant_id = $1
                 AND type = 'catalog.product.updated.v1') AS changes`,
      [TENANT_A],
    );
    expect(rows[0].history).toBe(2);
    expect(rows[0].changes).toEqual({ price: ["890", "950"], stock: ["25", "40"] });
  });

  it("listet mit Preis und Bestand, filtert nach Kategorie, Seiten ohne Lücken", async () => {
    for (const name of ["Assam", "Earl Grey", "Rooibos"]) {
      const r = await call("POST", "/admin/v1/products", "a", { name, price: { amount: 500 } });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ status: "draft", stock: 0, categoryId: null, taxClass: "standard" });
    }
    const first = await call("GET", "/admin/v1/products?limit=3", "a");
    expect(first.statusCode).toBe(200);
    expect(first.json().data[0]).toMatchObject({ id: productId, price: { amount: 950 }, stock: 40 });
    const next = await call("GET", `/admin/v1/products?limit=3&cursor=${first.json().page.nextCursor}`, "a");
    expect([...first.json().data, ...next.json().data].map((p: { name: string }) => p.name)).toEqual([
      "Sencha Frühlingshauch",
      "Assam",
      "Earl Grey",
      "Rooibos",
    ]);
    const inCategory = await call("GET", `/admin/v1/products?categoryId=${categoryId}`, "a");
    expect(inCategory.json().data).toHaveLength(1);
    const drafts = await call("GET", "/admin/v1/products?status=draft", "a");
    expect(drafts.json().data).toHaveLength(3);
  });

  it("sucht in Name und Artikelnummer, ohne Groß-/Kleinschreibung, % und _ zählen wörtlich", async () => {
    const skuProduct = await call("POST", "/admin/v1/products", "a", {
      name: "Kräutermischung 50_50",
      price: { amount: 700 },
      sku: "TEE-KR%1",
    });
    expect(skuProduct.statusCode).toBe(201);
    const names = async (q: string, extra = "") => {
      const r = await call("GET", `/admin/v1/products?q=${encodeURIComponent(q)}${extra}`, "a");
      expect(r.statusCode).toBe(200);
      return r.json().data.map((p: { name: string }) => p.name);
    };
    expect(await names("earl")).toEqual(["Earl Grey"]);
    expect(await names("FRÜHLING")).toEqual(["Sencha Frühlingshauch"]);
    expect(await names("tee-kr")).toEqual(["Kräutermischung 50_50"]);
    expect(await names("%")).toEqual(["Kräutermischung 50_50"]);
    expect(await names("0_5")).toEqual(["Kräutermischung 50_50"]);
    expect(await names("_")).toEqual(["Kräutermischung 50_50"]);
    expect(await names("  rooibos  ")).toEqual(["Rooibos"]);
    expect(await names("gibt es nicht")).toEqual([]);
    expect(await names("a", "&status=published")).toEqual(["Sencha Frühlingshauch"]);
    expect(await names("e", `&categoryId=${categoryId}`)).toEqual(["Sencha Frühlingshauch"]);
    expect((await call("GET", "/admin/v1/products?q=", "a")).statusCode).toBe(422);
    expect((await call("GET", `/admin/v1/products?q=${"x".repeat(101)}`, "a")).statusCode).toBe(422);
    expect((await call("GET", "/admin/v1/products?q=earl", "b")).json().data).toEqual([]);
  });

  it("Shop B sieht nichts von A; fremde Kategorie wird abgelehnt", async () => {
    expect((await call("GET", "/admin/v1/products", "b")).json().data).toEqual([]);
    expect((await call("GET", "/admin/v1/categories", "b")).json().data).toEqual([]);
    expect((await call("GET", `/admin/v1/products/${productId}`, "b")).statusCode).toBe(404);
    const foreign = await call("POST", "/admin/v1/products", "b", {
      name: "Hemd",
      price: { amount: 2990 },
      categoryId,
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().errors[0].code).toBe("unknown_category");
  });

  it("scheitert ein Teil, bleibt nichts halb angelegt (gleiche Artikelnummer)", async () => {
    const a = await call("POST", "/admin/v1/products", "b", {
      name: "Hemd",
      price: { amount: 2990 },
      sku: "H-1",
      stock: 5,
    });
    expect(a.statusCode).toBe(201);
    const before = await inspect.query(
      `SELECT (SELECT count(*)::int FROM catalog.product WHERE tenant_id = $1) AS products,
              (SELECT count(*)::int FROM pricing.price WHERE tenant_id = $1) AS prices,
              (SELECT count(*)::int FROM inventory.stock_level WHERE tenant_id = $1) AS stock`,
      [TENANT_B],
    );
    const dup = await call("POST", "/admin/v1/products", "b", {
      name: "Hemd 2",
      price: { amount: 1 },
      sku: "H-1",
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().errors[0].code).toBe("sku_taken");
    const after = await inspect.query(
      `SELECT (SELECT count(*)::int FROM catalog.product WHERE tenant_id = $1) AS products,
              (SELECT count(*)::int FROM pricing.price WHERE tenant_id = $1) AS prices,
              (SELECT count(*)::int FROM inventory.stock_level WHERE tenant_id = $1) AS stock`,
      [TENANT_B],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("Kategorie ändern und aus dem Produkt nehmen", async () => {
    const cat = await call(
      "PATCH",
      `/admin/v1/categories/${categoryId}`,
      "a",
      { name: "Grüner Tee", visible: false },
      { "if-match": '"1"' },
    );
    expect(cat.statusCode).toBe(200);
    expect(cat.json()).toMatchObject({ name: "Grüner Tee", slug: "gruentee", visible: false, version: 2 });
    const p = await call(
      "PATCH",
      `/admin/v1/products/${productId}`,
      "a",
      { categoryId: null },
      { "if-match": '"2"' },
    );
    expect(p.statusCode).toBe(200);
    expect(p.json().categoryId).toBeNull();
  });

  it("Produkt löschen: weg aus Liste und Shop, Artikelnummer wieder frei, fremder Shop 404", async () => {
    const made = await call("POST", "/admin/v1/products", "b", {
      name: "Mütze",
      price: { amount: 1490 },
      sku: "M-1",
      categoryId: (await call("POST", "/admin/v1/categories", "b", { name: "Mützen" })).json().id,
      status: "published",
    });
    expect(made.statusCode).toBe(201);
    const id = made.json().id;
    // Shop A kann das Produkt aus B nicht löschen.
    expect((await call("DELETE", `/admin/v1/products/${id}`, "a")).statusCode).toBe(404);
    const r = await call("DELETE", `/admin/v1/products/${id}`, "b");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id, deleted: true });
    expect((await call("GET", `/admin/v1/products/${id}`, "b")).statusCode).toBe(404);
    expect((await call("DELETE", `/admin/v1/products/${id}`, "b")).statusCode).toBe(404);
    const names = (await call("GET", "/admin/v1/products", "b"))
      .json()
      .data.map((p: { name: string }) => p.name);
    expect(names).not.toContain("Mütze");
    const again = await call("POST", "/admin/v1/products", "b", {
      name: "Mütze",
      price: { amount: 1 },
      sku: "M-1",
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().slug).toBe("muetze-2");
    const { rows } = await inspect.query(
      `SELECT (SELECT status FROM catalog.product WHERE id = $2) AS status,
              (SELECT count(*)::int FROM catalog.product_category WHERE product_id = $2) AS links,
              (SELECT data->>'name' FROM kernel.outbox WHERE tenant_id = $1
                 AND type = 'catalog.product.deleted.v1') AS event`,
      [TENANT_B, id],
    );
    expect(rows[0]).toEqual({ status: "archived", links: 0, event: "Mütze" });
  });

  it("Kategorie löschen: Produkte bleiben ohne Kategorie, fremder Shop 404", async () => {
    const cat = (await call("POST", "/admin/v1/categories", "a", { name: "Schwarztee" })).json();
    const prod = (
      await call("POST", "/admin/v1/products", "a", {
        name: "Ceylon",
        price: { amount: 600 },
        categoryId: cat.id,
      })
    ).json();
    expect((await call("DELETE", `/admin/v1/categories/${cat.id}`, "b")).statusCode).toBe(404);
    const r = await call("DELETE", `/admin/v1/categories/${cat.id}`, "a");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: cat.id, deleted: true, productsWithoutCategory: 1 });
    expect((await call("GET", `/admin/v1/categories/${cat.id}`, "a")).statusCode).toBe(404);
    const after = await call("GET", `/admin/v1/products/${prod.id}`, "a");
    expect(after.statusCode).toBe(200);
    expect(after.json().categoryId).toBeNull();
    const { rows } = await inspect.query(
      `SELECT count(*)::int AS n FROM kernel.outbox WHERE tenant_id = $1 AND type = 'catalog.category.deleted.v1'`,
      [TENANT_A],
    );
    expect(rows[0].n).toBe(1);
  });

  it("Testdaten: legt den Teeladen-Katalog über die API an, beim zweiten Mal nichts", async () => {
    const tenantId = uuidv7();
    await inspect.query(
      `WITH m AS (INSERT INTO platform.merchant (name) VALUES ('Tee') RETURNING id)
       INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
       SELECT $1, m.id, p.id, 'teeladen', 'Teeladen', 'active' FROM m, platform.plan p WHERE p.is_default`,
      [tenantId],
    );
    const options = { database, endpoints: allEndpoints({ database }), tenantId, handle: "teeladen" };
    expect(await seedCatalog(options)).toBe("3 Kategorien und 6 Produkte angelegt, 6 Bilder hochgeladen");
    expect(await seedCatalog(options)).toBe("Produkte gibt es schon, bleiben unverändert");
    // Testprodukte von vor M2 Teil 2 (ohne Bilder) bekommen ihre Bilder nachträglich.
    await inspect.query(`DELETE FROM catalog.product_media WHERE tenant_id = $1 AND position = 0`, [
      tenantId,
    ]);
    expect(await seedCatalog(options)).toMatch(/schon, .*6 Bilder hochgeladen$/);
    const { rows } = await inspect.query(
      `SELECT count(*)::int AS n, sum(amount)::int AS total FROM pricing.price WHERE tenant_id = $1`,
      [tenantId],
    );
    const expected = SEED_CATALOG["teeladen"]?.products.reduce((a, p) => a + p.price, 0);
    expect(rows[0]).toEqual({ n: 6, total: expected });
  });
});
