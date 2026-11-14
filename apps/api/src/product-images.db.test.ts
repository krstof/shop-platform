// MVP-Etappe M2 Teil 2 Ende zu Ende: Produktbilder über die Admin-API, gegen eine echte Datenbank
// als shop_app. Der Objektspeicher ist hier ein Speicher im Arbeitsspeicher (gleiche Schnittstelle
// wie Garage); den echten Weg über Garage und media.localhost prüft der Rauchtest.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createMedia, memoryStorage } from "@shop/media";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import sharp from "sharp";
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
    scopes: new Set(shop === "a" ? ["products:read", "products:write"] : ["products:read"]),
  };
  return auth;
};

const image = async (color: string, width = 1200, height = 900) =>
  (
    await sharp({ create: { width, height, channels: 3, background: color } })
      .jpeg()
      .toBuffer()
  ).toString("base64");

describe.skipIf(adminUrl === undefined)("Produktbilder (M2 Teil 2, echte Datenbank)", () => {
  const dbName = `api_images_${randomBytes(4).toString("hex")}`;
  const storage = memoryStorage();
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  let productId = "";

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
      [TENANT_A, "bilder-a"],
      [TENANT_B, "bilder-b"],
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
      applicationName: "api-images-test",
    });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        media: createMedia({ database, storage, publicBaseUrl: "https://media.localhost" }),
      }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
    });
    const r = await call("POST", "/admin/v1/products", "a", {
      name: "Sencha Frühlingshauch",
      price: { amount: 890 },
      status: "published",
    });
    productId = r.json().id;
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

  function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, shop: "a" | "b", payload?: object) {
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { "x-test-shop": shop },
        ...(payload === undefined ? {} : { payload }),
      });
  }

  const imagesUrl = () => `/admin/v1/products/${productId}/images`;
  let first = "";
  let second = "";

  it("lädt Bilder hoch: Antwort ist das Produkt mit Bildern in Reihenfolge, Version steigt", async () => {
    const before = (await call("GET", `/admin/v1/products/${productId}`, "a")).json();
    expect(before.images).toEqual([]);
    const r1 = await call("POST", imagesUrl(), "a", { data: await image("#7a9a5b"), filename: "sencha.jpg" });
    expect(r1.statusCode).toBe(201);
    const p1 = r1.json();
    expect(p1.version).toBe(before.version + 1);
    expect(p1.images).toHaveLength(1);
    first = p1.images[0].id;
    expect(p1.images[0]).toEqual({
      id: first,
      url: `https://media.localhost/tenants/${TENANT_A}/media/${first}/w1600.webp`,
      thumbnailUrl: `https://media.localhost/tenants/${TENANT_A}/media/${first}/w400.webp`,
      width: 1200,
      height: 900,
    });
    const r2 = await call("POST", imagesUrl(), "a", { data: await image("#c9b46a", 300, 600) });
    second = r2.json().images[1].id;
    expect(r2.json().images.map((i: { id: string }) => i.id)).toEqual([first, second]);
    // Liste zeigt die Bilder ebenfalls.
    const list = (await call("GET", "/admin/v1/products", "a")).json();
    expect(list.data[0].images).toHaveLength(2);
  });

  it("legt Original privat und zwei WebP-Fassungen öffentlich ab, Zeilen in media", async () => {
    const keys = [...storage.objects.keys()].filter((k) => k.includes(first)).sort();
    expect(keys).toEqual([
      `private:tenants/${TENANT_A}/media/${first}/original`,
      `public:tenants/${TENANT_A}/media/${first}/w1600.webp`,
      `public:tenants/${TENANT_A}/media/${first}/w400.webp`,
    ]);
    const pub = storage.objects.get(`public:tenants/${TENANT_A}/media/${first}/w1600.webp`);
    expect(pub?.contentType).toBe("image/webp");
    expect(pub?.cacheControl).toContain("immutable");
    const { rows } = await inspect.query(
      `SELECT a.status, a.original_filename, count(r.*)::int AS renditions
         FROM media.media_asset a JOIN media.media_rendition r ON r.media_asset_id = a.id
        WHERE a.id = $1 GROUP BY 1, 2`,
      [first],
    );
    expect(rows).toEqual([{ status: "ready", original_filename: "sencha.jpg", renditions: 2 }]);
    const { rows: events } = await inspect.query(
      `SELECT data FROM kernel.outbox WHERE type = 'catalog.product.updated.v1' ORDER BY id`,
    );
    expect(events.at(-1)?.data.changes.images).toEqual([first, `${first},${second}`]);
  });

  it("lehnt SVG und Text mit 422 am Feld data ab, kein halbes Bild bleibt", async () => {
    const count = storage.objects.size;
    for (const data of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64"),
      Buffer.from("kein bild").toString("base64"),
    ]) {
      const r = await call("POST", imagesUrl(), "a", { data, filename: "bild.png" });
      expect(r.statusCode).toBe(422);
      expect(r.json().errors[0]).toMatchObject({ path: "/data", code: "unsupported_format" });
    }
    const notBase64 = await call("POST", imagesUrl(), "a", { data: "%%%" });
    expect(notBase64.statusCode).toBe(422);
    expect(storage.objects.size).toBe(count);
  });

  it("ändert die Reihenfolge; eine unvollständige Liste ergibt 422", async () => {
    const r = await call("PUT", imagesUrl(), "a", { imageIds: [second, first] });
    expect(r.statusCode).toBe(200);
    expect(r.json().images.map((i: { id: string }) => i.id)).toEqual([second, first]);
    const bad = await call("PUT", imagesUrl(), "a", { imageIds: [second] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].code).toBe("image_ids_mismatch");
  });

  it("entfernt ein Bild samt Dateien und Zeilen", async () => {
    const r = await call("DELETE", `${imagesUrl()}/${second}`, "a");
    expect(r.statusCode).toBe(200);
    expect(r.json().images.map((i: { id: string }) => i.id)).toEqual([first]);
    expect([...storage.objects.keys()].some((k) => k.includes(second))).toBe(false);
    const { rows } = await inspect.query(`SELECT count(*)::int AS n FROM media.media_asset WHERE id = $1`, [
      second,
    ]);
    expect(rows[0].n).toBe(0);
    expect((await call("DELETE", `${imagesUrl()}/${second}`, "a")).statusCode).toBe(404);
  });

  it("Shop B sieht und ändert nichts von Shop A; ohne products:write gibt es 403", async () => {
    expect((await call("GET", `/admin/v1/products/${productId}`, "b")).statusCode).toBe(404);
    const add = await call("POST", imagesUrl(), "b", { data: await image("#000") });
    expect(add.statusCode).toBe(403);
    const { rows } = await inspect.query(
      `SELECT count(*)::int AS n FROM media.media_asset WHERE tenant_id = $1`,
      [TENANT_B],
    );
    expect(rows[0].n).toBe(0);
  });

  it("nimmt große Fotos an (bis 8 MB als Base64 über der allgemeinen Grenze von 1 MB)", async () => {
    // Rauschen lässt sich kaum komprimieren: so entsteht eine Datei von rund 3 MB.
    const noise = Buffer.from(randomBytes(1600 * 1200 * 3));
    const big = await sharp(noise, { raw: { width: 1600, height: 1200, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(1_048_576);
    const r = await call("POST", imagesUrl(), "a", { data: big.toString("base64") });
    expect(r.statusCode).toBe(201);
    // Andere Endpunkte bleiben bei 1 MB.
    const tooBig = await call("PATCH" as "POST", `/admin/v1/products/${productId}`, "a", {
      description: "x".repeat(1_100_000),
    });
    expect(tooBig.statusCode).toBe(413);
  });
  it("kopiert ein Produkt samt Bildern; geteilte Bilder bleiben, bis das letzte Produkt sie abgibt", async () => {
    const created = await call("POST", "/admin/v1/products", "a", {
      name: "Gyokuro",
      description: "Schattentee.",
      price: { amount: 2490 },
      taxClass: "reduced",
      stock: 7,
      sku: "GYO-1",
      status: "published",
    });
    const id = created.json().id;
    const img = (
      await call("POST", `/admin/v1/products/${id}/images`, "a", { data: await image("#335533") })
    ).json().images[0].id;
    const r = await call("POST", `/admin/v1/products/${id}/copy`, "a");
    expect(r.statusCode).toBe(201);
    const copy = r.json();
    expect(copy).toMatchObject({
      name: "Gyokuro (Kopie)",
      slug: "gyokuro-kopie",
      description: "Schattentee.",
      price: { amount: 2490, currency: "EUR" },
      taxClass: "reduced",
      stock: 0,
      sku: null,
      status: "draft",
    });
    expect(copy.id).not.toBe(id);
    expect(copy.images.map((i: { id: string }) => i.id)).toEqual([img]);
    // Zweite Kopie bekommt eine eigene Adresse.
    expect((await call("POST", `/admin/v1/products/${id}/copy`, "a")).json().slug).toBe("gyokuro-kopie-2");
    const files = () => [...storage.objects.keys()].filter((k) => k.includes(img)).length;
    expect(files()).toBe(3);
    // Bild von der Kopie nehmen: Original behält es samt Dateien.
    expect((await call("DELETE", `/admin/v1/products/${copy.id}/images/${img}`, "a")).statusCode).toBe(200);
    expect(files()).toBe(3);
    expect((await call("GET", `/admin/v1/products/${id}`, "a")).json().images).toHaveLength(1);
    // Die zweite Kopie hält das Bild noch; erst wenn kein Produkt es mehr nutzt, sind die Dateien weg.
    const copies = (await call("GET", "/admin/v1/products?q=gyokuro", "a")).json().data;
    for (const p of copies as { id: string; images: { id: string }[] }[])
      if (p.images.length > 0) await call("DELETE", `/admin/v1/products/${p.id}/images/${img}`, "a");
    expect(files()).toBe(0);
    // Unbekanntes Produkt 404, Shop ohne Schreibrecht 403.
    expect((await call("POST", `/admin/v1/products/${uuidv7()}/copy`, "a")).statusCode).toBe(404);
    expect((await call("POST", `/admin/v1/products/${id}/copy`, "b")).statusCode).toBe(403);
  });
});
