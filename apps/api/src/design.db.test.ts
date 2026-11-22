// Shop-Editor Teil 1 Ende zu Ende: Aussehen (Farbe, Schrift, Logo) über Admin- und Storefront-API,
// gegen eine echte Datenbank als shop_app. Objektspeicher im Arbeitsspeicher wie bei den Produktbildern.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createMedia, memoryStorage } from "@shop/media";
import { createShopDirectory } from "@shop/platform";
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
    // Shop B darf nur lesen: Schreiben ergibt 403.
    scopes: new Set(shop === "a" ? ["settings:read", "settings:write"] : ["settings:read"]),
  };
  return auth;
};

const logo = async () =>
  (
    await sharp({
      create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
  ).toString("base64");

describe.skipIf(adminUrl === undefined)("Aussehen des Shops (Shop-Editor Teil 1, echte Datenbank)", () => {
  const dbName = `api_design_${randomBytes(4).toString("hex")}`;
  const storage = memoryStorage();
  let admin: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    const setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    for (const [id, handle] of [
      [TENANT_A, "design-a"],
      [TENANT_B, "design-b"],
    ] as const) {
      await setup.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    await setup.end();
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "api-design-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        media: createMedia({ database, storage, publicBaseUrl: "https://media.localhost" }),
      }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
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

  function call(
    method: "GET" | "POST" | "PUT",
    url: string,
    shop?: "a" | "b",
    payload?: object,
    version?: number,
  ) {
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: {
          ...(shop === undefined ? {} : { "x-test-shop": shop }),
          ...(version === undefined ? {} : { "if-match": `"${version}"` }),
        },
        ...(payload === undefined ? {} : { payload }),
      });
  }

  it("zeigt ohne Änderungen den Standard, im Editor und im Shop", async () => {
    const r = await call("GET", "/admin/v1/design", "a");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      draft: { accentColor: "#3f6b4a", font: "klassisch", logo: null },
      hasUnpublishedChanges: false,
      publishedAt: null,
      version: 1,
    });
    const s = await call("GET", "/store/v1/shops/design-a/design");
    expect(s.json()).toEqual({
      accentColor: "#3f6b4a",
      accentDarkColor: "#2f5038",
      font: "klassisch",
      logo: null,
      home: {
        heroImage: null,
        heroTitle: "",
        heroText: "",
        featuredProductIds: [],
        showCategories: true,
        showNew: true,
        blocks: [
          { id: "buehne", type: "hero", title: "", text: "", image: null },
          { id: "empfohlen", type: "featured", heading: "", productIds: [] },
          { id: "neu", type: "new", heading: "" },
          { id: "kategorien", type: "categories", heading: "" },
        ],
        content: [
          { id: "buehne", type: "hero", title: "", text: "", image: null },
          { id: "empfohlen", type: "featured", heading: "", productIds: [] },
          { id: "neu", type: "new", heading: "" },
          { id: "kategorien", type: "categories", heading: "" },
        ],
      },
      tagline: "",
      footer: { text: "", links: [], social: {} },
      pages: [],
      backgroundColor: "#fbf8f3",
      headingFont: null,
      bodyFont: null,
      template: "klassisch",
      // Kopfzeile seit dem 22.11.2026: offenes Suchfeld, Kopf scrollt mit.
      header: { search: "offen", sticky: false },
    });
    expect((await call("GET", "/store/v1/shops/gibt-es-nicht/design")).statusCode).toBe(404);
  });

  it("Entwurf, Logo, Veröffentlichen: der Shop sieht erst danach etwas", async () => {
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    // Zu hell für weiße Schrift: 422 mit Feld.
    const hell = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      {
        accentColor: "#FFD84D",
        font: "modern",
        logoImageId: null,
      },
      start.version,
    );
    expect(hell.statusCode).toBe(422);
    expect(hell.json().errors[0].path).toBe("/accentColor");
    // Ohne If-Match: 428; mit alter Version: 412.
    const body = { accentColor: "#1F5F8B", font: "modern", logoImageId: null };
    expect((await call("PUT", "/admin/v1/design/draft", "a", body)).statusCode).toBe(428);
    expect((await call("PUT", "/admin/v1/design/draft", "a", body, start.version + 5)).statusCode).toBe(412);

    const saved = await call("PUT", "/admin/v1/design/draft", "a", body, start.version);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      draft: { accentColor: "#1f5f8b", font: "modern", logo: null },
      published: { accentColor: "#3f6b4a" },
      hasUnpublishedChanges: true,
    });
    // Shop zeigt noch den alten Stand.
    expect((await call("GET", "/store/v1/shops/design-a/design")).json().accentColor).toBe("#3f6b4a");

    const up = await call("POST", "/admin/v1/design/logo", "a", { data: await logo(), filename: "logo.png" });
    expect(up.statusCode).toBe(201);
    const withLogo = up.json();
    expect(withLogo.draft.logo).toMatchObject({ width: 400, height: 120 });
    expect(withLogo.draft.accentColor).toBe("#1f5f8b");
    expect(withLogo.published.logo).toBeNull();

    const pub = await call("POST", "/admin/v1/design/publish", "a");
    expect(pub.statusCode).toBe(200);
    expect(pub.json().hasUnpublishedChanges).toBe(false);
    expect(pub.json().publishedAt).not.toBeNull();
    const store = (await call("GET", "/store/v1/shops/design-a/design")).json();
    expect(store).toMatchObject({ accentColor: "#1f5f8b", accentDarkColor: "#174768", font: "modern" });
    expect(store.logo.url).toMatch(/^https:\/\/media\.localhost\/tenants\//);

    // Shop B sieht davon nichts und darf nicht schreiben.
    expect((await call("GET", "/admin/v1/design", "b")).json().draft.logo).toBeNull();
    expect((await call("GET", "/store/v1/shops/design-b/design")).json().accentColor).toBe("#3f6b4a");
    expect((await call("POST", "/admin/v1/design/publish", "b")).statusCode).toBe(403);
  });

  it("räumt ersetzte Logos weg, verwirft Entwürfe, nimmt keine fremden Bilder", async () => {
    const published = (await call("GET", "/admin/v1/design", "a")).json();
    const publishedLogo = published.published.logo.id as string;
    const has = (id: string) => [...storage.objects.keys()].some((k) => k.includes(id));

    // Neues Logo im Entwurf: das veröffentlichte bleibt (der Shop zeigt es noch).
    const second = (await call("POST", "/admin/v1/design/logo", "a", { data: await logo() })).json();
    expect(second.draft.logo.id).not.toBe(publishedLogo);
    expect(second.published.logo.id).toBe(publishedLogo);
    // Noch ein Logo: das zweite war nie veröffentlicht und wird gelöscht.
    const third = (await call("POST", "/admin/v1/design/logo", "a", { data: await logo() })).json();
    expect(has(second.draft.logo.id)).toBe(false);
    expect(has(third.draft.logo.id)).toBe(true);
    expect(has(publishedLogo)).toBe(true);

    // Verwerfen: Entwurf wie veröffentlicht, drittes Logo weg.
    const discarded = (await call("POST", "/admin/v1/design/discard", "a")).json();
    expect(discarded.hasUnpublishedChanges).toBe(false);
    expect(discarded.draft.logo.id).toBe(publishedLogo);
    expect(has(third.draft.logo.id)).toBe(false);
    expect(has(publishedLogo)).toBe(true);

    // Bild aus Shop B oder erfundene ID: 422.
    const b = (await call("GET", "/admin/v1/design", "b")).json();
    const fremd = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { accentColor: "#3f6b4a", font: "klassisch", logoImageId: uuidv7() },
      discarded.version,
    );
    expect(fremd.statusCode).toBe(422);
    expect(b.version).toBe(1);

    // Logo entfernen und veröffentlichen: altes Logo samt Dateien weg.
    const none = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { accentColor: "#3f6b4a", font: "klassisch", logoImageId: null },
      discarded.version,
    );
    expect(none.statusCode).toBe(200);
    await call("POST", "/admin/v1/design/publish", "a");
    expect(has(publishedLogo)).toBe(false);
    expect((await call("GET", "/store/v1/shops/design-a/design")).json().logo).toBeNull();
  });

  it("Startseite (Teil 2): Texte, Empfehlungen, Kategorien-Schalter und Bild", async () => {
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    expect(start.draft.home).toEqual({
      heroImage: null,
      heroTitle: "",
      heroText: "",
      featuredProductIds: [],
      showCategories: true,
      showNew: true,
      blocks: null,
      content: null,
      blockImages: [],
    });

    const featured = [uuidv7(), uuidv7()];
    const body = {
      accentColor: "#3f6b4a",
      font: "klassisch",
      logoImageId: null,
      home: {
        heroImageId: null,
        heroTitle: "Frischer Tee",
        heroText: "Lose Tees aus kleinen Gärten.",
        featuredProductIds: featured,
        showCategories: false,
        showNew: false,
      },
    };
    const saved = await call("PUT", "/admin/v1/design/draft", "a", body, start.version);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.home).toMatchObject({
      heroTitle: "Frischer Tee",
      heroText: "Lose Tees aus kleinen Gärten.",
      featuredProductIds: featured,
      showCategories: false,
      showNew: false,
    });
    expect(saved.json().hasUnpublishedChanges).toBe(true);
    // Der Shop zeigt die Startseite erst nach Veröffentlichen.
    const storeBefore = (await call("GET", "/store/v1/shops/design-a/design")).json();
    expect(storeBefore.home.heroTitle).toBe("");

    // Bild für die Startseite hochladen.
    const up = await call("POST", "/admin/v1/design/hero-image", "a", { data: await logo() });
    expect(up.statusCode).toBe(201);
    const heroId = up.json().draft.home.heroImage.id as string;
    expect(up.json().draft.home.heroImage).toMatchObject({ width: 400, height: 120 });
    // Texte aus dem vorher gespeicherten Entwurf bleiben erhalten.
    expect(up.json().draft.home.heroTitle).toBe("Frischer Tee");

    const pub = await call("POST", "/admin/v1/design/publish", "a");
    expect(pub.statusCode).toBe(200);
    const store = (await call("GET", "/store/v1/shops/design-a/design")).json();
    expect(store.home).toMatchObject({
      heroTitle: "Frischer Tee",
      heroText: "Lose Tees aus kleinen Gärten.",
      featuredProductIds: featured,
      showCategories: false,
      showNew: false,
    });
    expect(store.home.heroImage.url).toMatch(/^https:\/\/media\.localhost\/tenants\//);

    // Shop B sieht nichts davon.
    expect((await call("GET", "/store/v1/shops/design-b/design")).json().home).toEqual({
      heroImage: null,
      heroTitle: "",
      heroText: "",
      featuredProductIds: [],
      showCategories: true,
      showNew: true,
      blocks: [
        { id: "buehne", type: "hero", title: "", text: "", image: null },
        { id: "empfohlen", type: "featured", heading: "", productIds: [] },
        { id: "neu", type: "new", heading: "" },
        { id: "kategorien", type: "categories", heading: "" },
      ],
      content: [
        { id: "buehne", type: "hero", title: "", text: "", image: null },
        { id: "empfohlen", type: "featured", heading: "", productIds: [] },
        { id: "neu", type: "new", heading: "" },
        { id: "kategorien", type: "categories", heading: "" },
      ],
    });
    return heroId;
  });

  it("Startseite: zu lange Texte und fremde Bilder ergeben 422, Bilder werden aufgeräumt", async () => {
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    const has = (id: string) => [...storage.objects.keys()].some((k) => k.includes(id));
    const publishedHero = start.published.home.heroImage.id as string;

    // Zu lange Überschrift: 422 mit Feld /home/heroTitle.
    const langerTitel = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      {
        accentColor: "#3f6b4a",
        font: "klassisch",
        logoImageId: null,
        home: {
          heroImageId: null,
          heroTitle: "x".repeat(81),
          heroText: "",
          featuredProductIds: [],
          showCategories: true,
        },
      },
      start.version,
    );
    expect(langerTitel.statusCode).toBe(422);
    // Schema-Fehler tragen den Pfad mit /body-Präfix (anders als die Handler-Prüfungen weiter unten).
    expect(langerTitel.json().errors[0].path).toBe("/body/home/heroTitle");

    // Erfundenes Startseitenbild: 422 mit Feld /home/heroImageId.
    const fremdesBild = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      {
        accentColor: "#3f6b4a",
        font: "klassisch",
        logoImageId: null,
        home: {
          heroImageId: uuidv7(),
          heroTitle: "",
          heroText: "",
          featuredProductIds: [],
          showCategories: true,
        },
      },
      start.version,
    );
    expect(fremdesBild.statusCode).toBe(422);
    expect(fremdesBild.json().errors[0].path).toBe("/home/heroImageId");

    // Neues Bild hochladen (ersetzt nur im Entwurf): das veröffentlichte bleibt.
    const second = (await call("POST", "/admin/v1/design/hero-image", "a", { data: await logo() })).json();
    expect(second.draft.home.heroImage.id).not.toBe(publishedHero);
    expect(has(publishedHero)).toBe(true);

    // Startseitenbild entfernen und veröffentlichen: beide nicht mehr genutzten Bilder weg.
    const neuesBild = second.draft.home.heroImage.id as string;
    const ohneBild = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      {
        accentColor: "#3f6b4a",
        font: "klassisch",
        logoImageId: null,
        home: {
          heroImageId: null,
          heroTitle: "",
          heroText: "",
          featuredProductIds: [],
          showCategories: true,
        },
      },
      second.version,
    );
    expect(ohneBild.statusCode).toBe(200);
    expect(has(neuesBild)).toBe(false); // nie veröffentlicht, sofort weg
    await call("POST", "/admin/v1/design/publish", "a");
    expect(has(publishedHero)).toBe(false); // jetzt nicht mehr veröffentlicht
    expect((await call("GET", "/store/v1/shops/design-a/design")).json().home.heroImage).toBeNull();
  });

  it("Kopf- und Fußzeile (Teil 3): Slogan, Text, Links; gefährliche Links ergeben 422", async () => {
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    expect(start.draft.tagline).toBe("");
    expect(start.draft.footer).toEqual({ text: "", links: [], social: {} });
    const base = { accentColor: "#3f6b4a", font: "klassisch", logoImageId: null };

    // javascript:-Link: 422, nichts gespeichert.
    const boese = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { ...base, footer: { text: "", links: [{ label: "Klick", url: "javascript:alert(1)" }] } },
      start.version,
    );
    expect(boese.statusCode).toBe(422);
    expect(boese.json().errors[0].path).toBe("/body/footer/links/0/url");

    // Sechs Links: zu viele.
    const sechs = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: "https://a.example" }));
    const zuViele = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { ...base, footer: { text: "", links: sechs } },
      start.version,
    );
    expect(zuViele.statusCode).toBe(422);

    const footer = {
      text: "Mo–Fr 9–18 Uhr.",
      links: [
        { label: "Kontakt", url: "mailto:hallo@teeladen.example" },
        { label: "Anrufen", url: "tel:+49 40 123456" },
        { label: "Blog", url: "https://blog.teeladen.example" },
      ],
    };
    const saved = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { ...base, tagline: "Tee mit Herz", footer },
      start.version,
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft).toMatchObject({ tagline: "Tee mit Herz", footer });
    // Ohne tagline/footer im Körper bleiben sie im Entwurf stehen.
    const ohne = await call("PUT", "/admin/v1/design/draft", "a", base, saved.json().version);
    expect(ohne.json().draft).toMatchObject({ tagline: "Tee mit Herz", footer });
    expect((await call("GET", "/store/v1/shops/design-a/design")).json().tagline).toBe("");

    await call("POST", "/admin/v1/design/publish", "a");
    const store = (await call("GET", "/store/v1/shops/design-a/design")).json();
    expect(store).toMatchObject({ tagline: "Tee mit Herz", footer });
    // Shop B sieht nichts davon.
    expect((await call("GET", "/store/v1/shops/design-b/design")).json().footer).toEqual({
      text: "",
      links: [],
      social: {},
    });
  });
  it("Baukasten: Bausteine speichern, prüfen, veröffentlichen; Bilder werden aufgeräumt", async () => {
    const has = (id: string) => [...storage.objects.keys()].some((k) => k.includes(id));
    const up = await call("POST", "/admin/v1/design/images", "a", { data: await logo() });
    expect(up.statusCode).toBe(201);
    const imageId = up.json().id as string;
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    const base = {
      accentColor: "#3f6b4a",
      font: "klassisch",
      logoImageId: null,
      home: {
        heroImageId: null,
        heroTitle: "",
        heroText: "",
        featuredProductIds: [],
        showCategories: true,
      },
    };
    const blocks = [
      { id: "t1", type: "text", heading: "Über uns", text: "Seit 1998.\nMit Herz." },
      { id: "h1", type: "hero" },
      {
        id: "ti",
        type: "textImage",
        heading: "Der Laden",
        text: "Komm vorbei.",
        imageId,
        imageSide: "right",
      },
      { id: "v1", type: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { id: "v2", type: "video", url: "" },
      { id: "m1", type: "map", address: "Teeweg 1, 20095 Hamburg" },
      { id: "s1", type: "spacer", size: "l" },
    ];
    const bad = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      {
        ...base,
        home: { ...base.home, blocks: [{ id: "x", type: "video", url: "https://evil.example/v" }] },
      },
      start.version,
    );
    expect(bad.statusCode).toBe(422);
    const foreign = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      {
        ...base,
        home: { ...base.home, blocks: [{ id: "x", type: "image", imageId: uuidv7(), caption: "" }] },
      },
      start.version,
    );
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().errors[0].path).toBe("/home/blocks/0/imageId");
    const saved = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { ...base, home: { ...base.home, blocks } },
      start.version,
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.home.blocks.map((b: { id: string }) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(saved.json().draft.home.blockImages.map((i: { id: string }) => i.id)).toEqual([imageId]);
    // Ohne `blocks` im nächsten Speichern bleiben sie erhalten.
    const kept = await call("PUT", "/admin/v1/design/draft", "a", base, saved.json().version);
    expect(kept.json().draft.home.blocks).toHaveLength(blocks.length);
    expect((await call("POST", "/admin/v1/design/publish", "a")).statusCode).toBe(200);
    const store = (await call("GET", "/store/v1/shops/design-a/design")).json().home.blocks;
    expect(store.map((b: { type: string }) => b.type)).toEqual([
      "text",
      "hero",
      "textImage",
      "video",
      "map",
      "spacer",
    ]);
    expect(store[2].image.url).toContain(imageId);
    expect(store[3]).toEqual({ id: "v1", type: "video", provider: "youtube", videoId: "dQw4w9WgXcQ" });
    // Bild aus dem Baustein entfernen und veröffentlichen: Dateien sind weg.
    const next = (await call("GET", "/admin/v1/design", "a")).json();
    const without = blocks.filter((b) => b.id !== "ti");
    await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { ...base, home: { ...base.home, blocks: without } },
      next.version,
    );
    expect(has(imageId)).toBe(true); // noch veröffentlicht
    await call("POST", "/admin/v1/design/publish", "a");
    expect(has(imageId)).toBe(false);
    expect(
      (await call("GET", "/store/v1/shops/design-b/design"))
        .json()
        .home.blocks.map((b: { type: string }) => b.type),
    ).toEqual(["hero", "featured", "new", "categories"]);
  });

  it("Eigene Seiten: speichern, prüfen, veröffentlichen, nur im eigenen Shop", async () => {
    const up = await call("POST", "/admin/v1/design/images", "a", { data: await logo() });
    const imageId = up.json().id as string;
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    const base = { accentColor: "#3f6b4a", font: "klassisch", logoImageId: null };
    const page = {
      id: "p1",
      title: "Über uns",
      slug: "ueber-uns",
      inFooter: true,
      blocks: [
        { id: "t1", type: "text", heading: "Wer wir sind", text: "Seit 1998." },
        { id: "i1", type: "image", imageId, caption: "Der Laden" },
        { id: "m1", type: "map", address: "Teeweg 1, 20095 Hamburg" },
      ],
    };
    const put = (body: object, version: number) => call("PUT", "/admin/v1/design/draft", "a", body, version);
    expect((await put({ ...base, backgroundColor: "#202020" }, start.version)).statusCode).toBe(422);
    expect((await put({ ...base, pages: [{ ...page, slug: "Über uns" }] }, start.version)).statusCode).toBe(
      422,
    );
    expect((await put({ ...base, pages: [page, { ...page, id: "p2" }] }, start.version)).statusCode).toBe(
      422,
    );
    const foreign = await put(
      { ...base, pages: [{ ...page, blocks: [{ id: "i", type: "image", imageId: uuidv7(), caption: "" }] }] },
      start.version,
    );
    expect(foreign.json().errors[0].path).toBe("/pages/0/blocks/0/imageId");
    const saved = await put({ ...base, pages: [page] }, start.version);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.pages[0]).toMatchObject({ slug: "ueber-uns", inFooter: true });
    expect(saved.json().draft.pages[0].blockImages.map((i: { id: string }) => i.id)).toEqual([imageId]);
    expect(saved.json().hasUnpublishedChanges).toBe(true);
    // Vor dem Veröffentlichen gibt es die Seite im Shop nicht.
    expect((await call("GET", "/store/v1/shops/design-a/pages/ueber-uns")).statusCode).toBe(404);
    await call("POST", "/admin/v1/design/publish", "a");
    expect((await call("GET", "/store/v1/shops/design-a/design")).json().pages).toEqual([
      { title: "Über uns", slug: "ueber-uns", inFooter: true },
    ]);
    const store = await call("GET", "/store/v1/shops/design-a/pages/ueber-uns");
    expect(store.statusCode).toBe(200);
    expect(store.json().title).toBe("Über uns");
    expect(store.json().blocks.map((b: { type: string }) => b.type)).toEqual(["text", "image", "map"]);
    expect(store.json().blocks[1].image.url).toContain(imageId);
    // Anderer Shop sieht die Seite nicht.
    expect((await call("GET", "/store/v1/shops/design-b/pages/ueber-uns")).statusCode).toBe(404);
    expect((await call("GET", "/store/v1/shops/design-a/pages/gibt-es-nicht")).statusCode).toBe(404);
    // Seite löschen und veröffentlichen: Bild ist weg.
    const has = (id: string) => [...storage.objects.keys()].some((k) => k.includes(id));
    expect(
      (await put({ ...base, pages: [] }, (await call("GET", "/admin/v1/design", "a")).json().version))
        .statusCode,
    ).toBe(200);
    await call("POST", "/admin/v1/design/publish", "a");
    expect(has(imageId)).toBe(false);
    expect((await call("GET", "/store/v1/shops/design-a/pages/ueber-uns")).statusCode).toBe(404);
  });

  it("Mehrere Shop-Bereiche mit eigenem Inhalt, Hintergrund, Schriften und soziale Netzwerke", async () => {
    const up = await call("POST", "/admin/v1/design/images", "a", { data: await logo() });
    const imageId = up.json().id as string;
    const start = (await call("GET", "/admin/v1/design", "a")).json();
    const body = {
      accentColor: "#3f6b4a",
      font: "klassisch",
      logoImageId: null,
      backgroundColor: "#FFFFFF",
      template: "boutique",
      headingFont: { id: "playfair-display", name: "Playfair Display", category: "serif" },
      bodyFont: { id: "dm-sans", name: "DM Sans", category: "sans-serif" },
      footer: {
        text: "",
        links: [],
        social: { instagram: "https://instagram.com/teeladen", tiktok: "" },
      },
      home: {
        heroImageId: null,
        heroTitle: "Alt",
        heroText: "",
        featuredProductIds: [],
        showCategories: true,
        blocks: [
          { id: "h1", type: "hero" },
          { id: "h2", type: "hero" },
          { id: "f1", type: "featured" },
          { id: "g1", type: "gallery", imageIds: [imageId], caption: "Laden" },
          { id: "b1", type: "button", label: "Über uns", url: "/seite/ueber-uns", style: "primary" },
          { id: "q1", type: "quote", text: "Bester Tee.", author: "Kim" },
          { id: "d1", type: "divider" },
          { id: "x1", type: "faq", heading: "Fragen", items: [{ question: "Versand?", answer: "2 Tage." }] },
        ],
        sections: {
          h1: { title: "Sommer", text: "Eistee", imageId },
          h2: { title: "Winter", text: "", imageId: null },
          f1: { heading: "Lieblinge", productIds: [] },
        },
      },
    };
    const bad = await call(
      "PUT",
      "/admin/v1/design/draft",
      "a",
      { ...body, footer: { ...body.footer, social: { instagram: "http://unsicher.example" } } },
      start.version,
    );
    expect(bad.statusCode).toBe(422);
    const saved = await call("PUT", "/admin/v1/design/draft", "a", body, start.version);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft).toMatchObject({
      backgroundColor: "#ffffff",
      headingFont: { id: "playfair-display" },
      footer: { social: { instagram: "https://instagram.com/teeladen" } },
    });
    expect(saved.json().draft.home.blockImages.map((i: { id: string }) => i.id)).toEqual([imageId, imageId]);
    expect(saved.json().draft.home.content[0]).toEqual({
      id: "h1",
      type: "hero",
      title: "Sommer",
      text: "Eistee",
      imageId,
    });
    expect(saved.json().draft.home.blocks[0]).toEqual({ id: "h1", type: "hero" });
    await call("POST", "/admin/v1/design/publish", "a");
    const store = (await call("GET", "/store/v1/shops/design-a/design")).json();
    expect(store).toMatchObject({
      backgroundColor: "#ffffff",
      bodyFont: { name: "DM Sans" },
      template: "boutique",
    });
    // Altes Feld `blocks`: nur alte Arten, Shop-Bereiche wie bisher; `content` hat alles.
    expect(store.home.blocks.map((b: { type: string }) => b.type)).toEqual(["hero", "hero", "featured"]);
    const [h1, h2, f1, g1] = store.home.content;
    expect(h1).toMatchObject({ type: "hero", title: "Sommer", text: "Eistee" });
    expect(h1.image.url).toContain(imageId);
    expect(h2).toEqual({ id: "h2", type: "hero", title: "Winter", text: "", image: null });
    expect(f1).toEqual({ id: "f1", type: "featured", heading: "Lieblinge", productIds: [] });
    expect(g1.images).toHaveLength(1);
    expect(store.home.content.map((b: { type: string }) => b.type)).toEqual([
      "hero",
      "hero",
      "featured",
      "gallery",
      "button",
      "quote",
      "divider",
      "faq",
    ]);
  });
});
