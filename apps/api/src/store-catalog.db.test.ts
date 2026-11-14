// MVP-Etappe M4: Storefront-API gegen eine echte Datenbank. Nur Sichtbares, nur aktive Shops,
// jeder Shop sieht nur seine eigenen Produkte (der Shop kommt aus dem Pfad).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
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
const TENANT_OFF = uuidv7();

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

describe.skipIf(adminUrl === undefined)("Storefront-API: Katalog (M4, echte Datenbank)", () => {
  const dbName = `api_store_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;

  const inject = (method: "GET" | "POST" | "PATCH", url: string, shop?: "a" | "b", payload?: object) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: shop === undefined ? {} : { "x-test-shop": shop },
        ...(payload === undefined ? {} : { payload }),
      });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    inspect = new pg.Client({ connectionString: setupUrl.href });
    await inspect.connect();
    for (const [id, handle, status] of [
      [TENANT_A, "tee-a", "active"],
      [TENANT_B, "mode-b", "active"],
      [TENANT_OFF, "gesperrt", "suspended"],
    ] as const) {
      await inspect.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, $3 FROM m, platform.plan p WHERE p.is_default`,
        [id, handle, status],
      );
    }
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "api-store-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
    });
    const cat = (await inject("POST", "/admin/v1/categories", "a", { name: "Grüntee" })).json();
    for (const [name, status, stock] of [
      ["Sencha", "published", 5],
      ["Geheimer Entwurf", "draft", 5],
      ["Matcha", "published", 0],
    ] as const) {
      await inject("POST", "/admin/v1/products", "a", {
        name,
        status,
        stock,
        price: { amount: 890 },
        taxClass: "reduced",
        sku: `SKU-${name}`,
        categoryId: cat.id,
      });
    }
    await inject("POST", "/admin/v1/products", "b", {
      name: "T-Shirt",
      status: "published",
      price: { amount: 1990 },
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

  it("zeigt Name des Shops; unbekannte und gesperrte Shops ergeben 404", async () => {
    expect((await inject("GET", "/store/v1/shops/tee-a")).json()).toEqual({ handle: "tee-a", name: "tee-a" });
    expect((await inject("GET", "/store/v1/shops/gibt-es-nicht")).statusCode).toBe(404);
    expect((await inject("GET", "/store/v1/shops/gesperrt")).statusCode).toBe(404);
    expect((await inject("GET", "/store/v1/shops/gesperrt/products")).statusCode).toBe(404);
  });

  it("listet nur veröffentlichte Produkte des eigenen Shops, ohne Artikelnummer und Bestand", async () => {
    const r = await inject("GET", "/store/v1/shops/tee-a/products");
    expect(r.statusCode).toBe(200);
    const names = r.json().data.map((p: { name: string }) => p.name);
    expect(names).toEqual(["Sencha", "Matcha"]);
    expect(r.body).not.toContain("SKU-");
    expect(r.body).not.toContain("T-Shirt");
    const [sencha, matcha] = r.json().data;
    expect(sencha).toMatchObject({
      price: { amount: 890, currency: "EUR" },
      taxRatePercent: 7,
      inStock: true,
      maxQuantity: 5,
    });
    expect(sencha.stock).toBeUndefined();
    expect(matcha).toMatchObject({ inStock: false, maxQuantity: 0 });
    const b = (await inject("GET", "/store/v1/shops/mode-b/products")).json();
    expect(b.data.map((p: { name: string }) => p.name)).toEqual(["T-Shirt"]);
  });

  it("filtert nach Kategorie, liest Produkt per Adresse, Entwurf bleibt unsichtbar", async () => {
    const cats = (await inject("GET", "/store/v1/shops/tee-a/categories")).json().data;
    expect(cats.map((c: { slug: string }) => c.slug)).toEqual(["gruentee"]);
    expect(
      (await inject("GET", "/store/v1/shops/tee-a/products?category=gruentee")).json().data,
    ).toHaveLength(2);
    expect((await inject("GET", "/store/v1/shops/tee-a/products?category=gibts-nicht")).statusCode).toBe(404);
    expect((await inject("GET", "/store/v1/shops/tee-a/products/sencha")).json().name).toBe("Sencha");
    expect((await inject("GET", "/store/v1/shops/tee-a/products/geheimer-entwurf")).statusCode).toBe(404);
    // Fremder Shop im Pfad: das Produkt aus A gibt es dort nicht.
    expect((await inject("GET", "/store/v1/shops/mode-b/products/sencha")).statusCode).toBe(404);
  });

  it("sucht in Name und Beschreibung veröffentlichter Produkte (Storefront-Suche)", async () => {
    await inject("POST", "/admin/v1/products", "a", {
      name: "Oolong Bergnebel",
      status: "published",
      stock: 3,
      price: { amount: 1290 },
      description: "Halbfermentiert und blumig.\n\nFür 100%_Genuss am Nachmittag.",
    });
    await inject("POST", "/admin/v1/products", "a", {
      name: "Blumiger Entwurf",
      status: "draft",
      price: { amount: 990 },
    });
    const names = async (url: string) =>
      (await inject("GET", url)).json().data.map((p: { name: string }) => p.name);
    expect(await names("/store/v1/shops/tee-a/products?q=SENCH")).toEqual(["Sencha"]);
    // Beschreibung, auch der zweite Absatz; der Entwurf bleibt unsichtbar.
    expect(await names("/store/v1/shops/tee-a/products?q=blumig")).toEqual(["Oolong Bergnebel"]);
    expect(await names("/store/v1/shops/tee-a/products?q=nachmittag")).toEqual(["Oolong Bergnebel"]);
    // JSON-Schlüssel der Beschreibung zählen nicht; % und _ sind normale Zeichen.
    expect(await names("/store/v1/shops/tee-a/products?q=paragraph")).toEqual([]);
    expect(await names("/store/v1/shops/tee-a/products?q=%25")).toEqual(["Oolong Bergnebel"]);
    expect(await names("/store/v1/shops/tee-a/products?q=a_a")).toEqual([]);
    // Kombination mit Kategorie: Oolong hat keine.
    expect(await names("/store/v1/shops/tee-a/products?q=oolong&category=gruentee")).toEqual([]);
    expect(await names("/store/v1/shops/tee-a/products?q=a&category=gruentee")).toEqual(["Sencha", "Matcha"]);
    // Fremder Shop findet nichts aus A.
    expect(await names("/store/v1/shops/mode-b/products?q=sencha")).toEqual([]);
    expect((await inject("GET", "/store/v1/shops/tee-a/products?q=")).statusCode).toBe(422);
    expect((await inject("GET", `/store/v1/shops/tee-a/products?q=${"x".repeat(101)}`)).statusCode).toBe(422);
  });

  it("sortiert nach Preis, Name und Neuheit; falsche Sortierung 422", async () => {
    await inject("POST", "/admin/v1/products", "a", {
      name: "Assam",
      status: "published",
      stock: 1,
      price: { amount: 590 },
    });
    const names = async (sort: string) =>
      (await inject("GET", `/store/v1/shops/tee-a/products?sort=${sort}`))
        .json()
        .data.map((p: { name: string }) => p.name);
    const standard = await names("standard");
    expect(await names("newest")).toEqual([...standard].reverse());
    expect((await names("price-asc"))[0]).toBe("Assam");
    expect((await names("price-desc"))[0]).toBe("Oolong Bergnebel");
    expect(await names("name")).toEqual([...standard].sort((a, b) => a.localeCompare(b, "de")));
    expect(
      (await inject("GET", "/store/v1/shops/tee-a/products?sort=name&q=a&category=gruentee"))
        .json()
        .data.map((p: { name: string }) => p.name),
    ).toEqual(["Matcha", "Sencha"]);
    expect((await inject("GET", "/store/v1/shops/tee-a/products?sort=billig")).statusCode).toBe(422);
  });

  it("ein frisch gesperrter Shop verschwindet sofort", async () => {
    await inspect.query(`UPDATE platform.tenant SET status = 'suspended' WHERE id = $1`, [TENANT_B]);
    expect((await inject("GET", "/store/v1/shops/mode-b/products")).statusCode).toBe(404);
    await inspect.query(`UPDATE platform.tenant SET status = 'active' WHERE id = $1`, [TENANT_B]);
  });
});
