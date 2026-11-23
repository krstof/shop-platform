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

  const inject = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    shop?: "a" | "b",
    payload?: object,
    extra: Record<string, string> = {},
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { ...(shop === undefined ? {} : { "x-test-shop": shop }), ...extra },
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

  it("Suchwörter und Neu-Schildchen je Produkt (Paket P5)", async () => {
    const angelegt = (
      await inject("POST", "/admin/v1/products", "a", {
        name: "Teedose Kirschblüte",
        status: "published",
        stock: 5,
        price: { amount: 1490 },
        description: "Luftdichte Dose aus Weißblech.",
        searchKeywords: "Geschenk, Mitbringsel",
        lowStockThreshold: 2,
        newBadge: "always",
      })
    ).json();
    expect(angelegt.searchKeywords).toBe("Geschenk, Mitbringsel");
    expect(angelegt.lowStockThreshold).toBe(2);
    expect(angelegt.newBadge).toBe("always");

    const names = async (url: string) =>
      (await inject("GET", url)).json().data.map((p: { name: string }) => p.name);
    // Das Wort steht nirgends im Text, die Suche findet das Produkt trotzdem.
    expect(await names("/store/v1/shops/tee-a/products?q=geschenk")).toEqual(["Teedose Kirschblüte"]);
    expect(await names("/store/v1/shops/tee-a/products?q=MITBRING")).toEqual(["Teedose Kirschblüte"]);
    // Auch die Suche im Backoffice findet es über die Suchwörter.
    const imBackoffice = (await inject("GET", "/admin/v1/products?q=mitbringsel", "a")).json();
    expect(imBackoffice.data.map((p: { name: string }) => p.name)).toEqual(["Teedose Kirschblüte"]);
    // Der Shop sieht den Schalter, aber keine internen Felder.
    const imShop = (await inject("GET", "/store/v1/shops/tee-a/products?q=geschenk")).json().data[0];
    expect(imShop.newBadge).toBe("always");
    expect(imShop.lowStockThreshold).toBeUndefined();
    expect(imShop.searchKeywords).toBeUndefined();

    // Suchwörter und Mindestbestand wieder wegnehmen.
    const geaendert = (
      await inject(
        "PATCH",
        `/admin/v1/products/${angelegt.id}`,
        "a",
        { searchKeywords: null, lowStockThreshold: null, newBadge: "never" },
        { "if-match": `"${angelegt.version}"` },
      )
    ).json();
    expect(geaendert.searchKeywords).toBeNull();
    expect(geaendert.lowStockThreshold).toBeNull();
    expect(geaendert.newBadge).toBe("never");
    expect(await names("/store/v1/shops/tee-a/products?q=geschenk")).toEqual([]);

    // Aufräumen, damit die folgenden Prüfungen denselben Katalog sehen wie vorher.
    const weg = await inject("DELETE", `/admin/v1/products/${angelegt.id}`, "a");
    expect(weg.statusCode).toBe(200);
  });

  it("Video am Produkt: eigene Datei und YouTube (Paket P5)", async () => {
    const neu = (
      await inject("POST", "/admin/v1/products", "a", {
        name: "Teekanne Guss",
        status: "published",
        stock: 2,
        price: { amount: 4900 },
      })
    ).json();
    expect(neu.video).toBeNull();

    // Eigene Datei: ein winziges, gültiges MP4-Gerüst reicht für die Prüfung der Schnittstelle.
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisom"),
      Buffer.alloc(12),
    ]).toString("base64");
    const mitDatei = (
      await inject("POST", `/admin/v1/products/${neu.id}/video`, "a", {
        data: mp4,
        filename: "kanne.mp4",
        autoplay: true,
      })
    ).json();
    expect(mitDatei.video.kind).toBe("file");
    expect(mitDatei.video.autoplay).toBe(true);
    expect(mitDatei.video.url).toMatch(/\/video\.mp4$/);

    // Im Shop ist das Video sichtbar.
    const imShop = (await inject("GET", "/store/v1/shops/tee-a/products/teekanne-guss")).json();
    expect(imShop.video.kind).toBe("file");
    expect(imShop.video.autoplay).toBe(true);

    // Keine Videodatei: 422 mit Hinweis, das alte Video bleibt.
    const falsch = await inject("POST", `/admin/v1/products/${neu.id}/video`, "a", {
      data: Buffer.from("das ist kein Video").toString("base64"),
    });
    expect(falsch.statusCode).toBe(422);
    expect(falsch.json().errors[0].code).toBe("unsupported_format");

    // Link zu YouTube ersetzt die Datei.
    const mitLink = (
      await inject(
        "PATCH",
        `/admin/v1/products/${neu.id}`,
        "a",
        { videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        { "if-match": `"${mitDatei.video === null ? neu.version : mitDatei.version}"` },
      )
    ).json();
    expect(mitLink.video).toEqual({
      kind: "youtube",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      providerId: "dQw4w9WgXcQ",
      autoplay: false,
    });

    // Eine fremde Adresse wird abgelehnt.
    const fremd = await inject(
      "PATCH",
      `/admin/v1/products/${neu.id}`,
      "a",
      { videoUrl: "https://evil.example/watch?v=dQw4w9WgXcQ" },
      { "if-match": `"${mitLink.version}"` },
    );
    expect(fremd.statusCode).toBe(422);
    expect(fremd.json().errors[0].path).toBe("/videoUrl");

    // Wegnehmen.
    const ohne = (await inject("DELETE", `/admin/v1/products/${neu.id}/video`, "a")).json();
    expect(ohne.video).toBeNull();
    expect((await inject("DELETE", `/admin/v1/products/${neu.id}/video`, "a")).statusCode).toBe(404);

    await inject("DELETE", `/admin/v1/products/${neu.id}`, "a");
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
    // Nur verfügbare: Matcha (Bestand 0) fällt weg; publishedAt für „Neu“.
    const avail = (await inject("GET", "/store/v1/shops/tee-a/products?available=true")).json().data;
    expect(avail.map((p: { name: string }) => p.name)).not.toContain("Matcha");
    expect(avail.every((p: { inStock: boolean }) => p.inStock)).toBe(true);
    expect(Date.parse(avail[0].publishedAt)).toBeGreaterThan(Date.now() - 600_000);
  });

  it("Angebotspreis: Shop verkauft günstiger und nennt den alten Preis; Prüfungen 422", async () => {
    const tooHigh = await inject("POST", "/admin/v1/products", "a", {
      name: "Zu teuer im Angebot",
      price: { amount: 1000 },
      salePrice: { amount: 1000 },
    });
    expect(tooHigh.statusCode).toBe(422);
    expect(tooHigh.json().errors[0].path).toBe("/salePrice/amount");
    const made = await inject("POST", "/admin/v1/products", "a", {
      name: "Rooibos Vanille",
      status: "published",
      stock: 4,
      price: { amount: 990 },
      salePrice: { amount: 690 },
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      price: { amount: 990 },
      salePrice: { amount: 690, currency: "EUR" },
    });
    const id = made.json().id;
    const store = async () => (await inject("GET", "/store/v1/shops/tee-a/products/rooibos-vanille")).json();
    expect(await store()).toMatchObject({
      price: { amount: 690, currency: "EUR" },
      compareAtPrice: { amount: 990, currency: "EUR" },
    });
    // Ohne Angebot: compareAtPrice null.
    expect((await inject("GET", "/store/v1/shops/tee-a/products/sencha")).json().compareAtPrice).toBeNull();
    // Sortieren nach Preis nimmt den Angebotspreis.
    const asc = (await inject("GET", "/store/v1/shops/tee-a/products?sort=price-asc")).json().data;
    expect(asc.findIndex((p: { name: string }) => p.name === "Rooibos Vanille")).toBeLessThan(
      asc.findIndex((p: { name: string }) => p.name === "Sencha"),
    );
    // Preis unter das Angebot senken: 422; Angebot und Preis zusammen ändern geht.
    const v = made.json().version;
    const lower = await inject(
      "PATCH",
      `/admin/v1/products/${id}`,
      "a",
      { price: { amount: 600 } },
      {
        "if-match": `"${v}"`,
      },
    );
    expect(lower.statusCode).toBe(422);
    const both = await inject(
      "PATCH",
      `/admin/v1/products/${id}`,
      "a",
      { price: { amount: 600 }, salePrice: { amount: 500 } },
      { "if-match": `"${v}"` },
    );
    expect(both.statusCode).toBe(200);
    expect(await store()).toMatchObject({ price: { amount: 500 }, compareAtPrice: { amount: 600 } });
    // Angebot beenden.
    const end = await inject(
      "PATCH",
      `/admin/v1/products/${id}`,
      "a",
      { salePrice: null },
      {
        "if-match": `"${both.json().version}"`,
      },
    );
    expect(end.statusCode).toBe(200);
    expect(end.json().salePrice).toBeNull();
    expect(await store()).toMatchObject({ price: { amount: 600 }, compareAtPrice: null });
  });

  it("Lieferzeit: setzen, im Shop lesen, entfernen; von > bis 422", async () => {
    const made = await inject("POST", "/admin/v1/products", "a", {
      name: "Pu-Erh",
      status: "published",
      stock: 2,
      price: { amount: 1590 },
      deliveryDays: { min: 2, max: 4 },
    });
    expect(made.statusCode).toBe(201);
    expect(made.json().deliveryDays).toEqual({ min: 2, max: 4 });
    expect((await inject("GET", "/store/v1/shops/tee-a/products/pu-erh")).json().deliveryDays).toEqual({
      min: 2,
      max: 4,
    });
    const bad = await inject("POST", "/admin/v1/products", "a", {
      name: "Falsch",
      price: { amount: 1 },
      deliveryDays: { min: 5, max: 2 },
    });
    expect(bad.statusCode).toBe(422);
    const cleared = await inject(
      "PATCH",
      `/admin/v1/products/${made.json().id}`,
      "a",
      { deliveryDays: null },
      { "if-match": `"${made.json().version}"` },
    );
    expect(cleared.json().deliveryDays).toBeNull();
    expect((await inject("GET", "/store/v1/shops/tee-a/products/pu-erh")).json().deliveryDays).toBeNull();
  });

  it("ein frisch gesperrter Shop verschwindet sofort", async () => {
    await inspect.query(`UPDATE platform.tenant SET status = 'suspended' WHERE id = $1`, [TENANT_B]);
    expect((await inject("GET", "/store/v1/shops/mode-b/products")).statusCode).toBe(404);
    await inspect.query(`UPDATE platform.tenant SET status = 'active' WHERE id = $1`, [TENANT_B]);
  });
});
