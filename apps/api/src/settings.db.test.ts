// Einstellungen „Allgemein“: Adresse, Geschäftsangaben, Shop geöffnet und Shop-Name (umbenennen
// in platform.tenant), Storefront-API sagt, ob der Shop geöffnet ist.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createShopAdministration, createShopDirectory } from "@shop/platform";
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
  company: "Teeladen GmbH",
  firstName: "Kim",
  lastName: "Muster",
  email: "Hallo@Teeladen.example",
  phone: "040 123",
  fax: "",
  country: "DE",
  street: "Teeweg 1",
  addressLine2: "",
  postalCode: "20095",
  city: "Hamburg",
  region: "",
};

describe.skipIf(adminUrl === undefined)("Einstellungen „Allgemein“ (echte Datenbank)", () => {
  const dbName = `api_settings_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let platformDatabase: Database<unknown>;
  let app: NestFastifyApplication;

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
      applicationName: "api-settings-test",
    });
    platformDatabase = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_platform"),
      maxConnections: 2,
      applicationName: "api-settings-test-platform",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        platformShops: createShopAdministration({ database: platformDatabase }),
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
    await platformDatabase?.destroy();
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  it("zeigt Standardwerte, speichert, benennt um, schließt und öffnet den Shop", async () => {
    const start = await inject("GET", "/admin/v1/settings/general", undefined, asA);
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({
      shopName: "teeladen",
      shopOpen: true,
      version: 0,
      address: { country: "DE" },
    });
    expect((await inject("GET", "/store/v1/shops/teeladen/status")).json()).toEqual({ open: true });

    const body = {
      shopName: "Teeladen Morgentau",
      shopOpen: false,
      address: ADDRESS,
      vatId: "de 123456789",
      tradeRegister: "Amtsgericht Hamburg, HRB 1",
    };
    // Pflichtfelder und Format
    const bad = await inject(
      "PUT",
      "/admin/v1/settings/general",
      { ...body, address: { ...ADDRESS, firstName: " " } },
      { ...asA, "if-match": '"0"' },
    );
    expect(bad.statusCode).toBe(422);
    expect(
      (
        await inject(
          "PUT",
          "/admin/v1/settings/general",
          { ...body, vatId: "123" },
          { ...asA, "if-match": '"0"' },
        )
      ).statusCode,
    ).toBe(422);
    // Falsche Version
    expect(
      (await inject("PUT", "/admin/v1/settings/general", body, { ...asA, "if-match": '"5"' })).statusCode,
    ).toBe(412);

    const saved = await inject("PUT", "/admin/v1/settings/general", body, { ...asA, "if-match": '"0"' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      shopName: "Teeladen Morgentau",
      shopOpen: false,
      vatId: "DE123456789",
      version: 1,
      address: { email: "hallo@teeladen.example", company: "Teeladen GmbH" },
    });
    expect((await inject("GET", "/store/v1/shops/teeladen")).json().name).toBe("Teeladen Morgentau");
    expect((await inject("GET", "/store/v1/shops/teeladen/status")).json()).toEqual({ open: false });
    // Anderer Shop bleibt unberührt.
    expect((await inject("GET", "/store/v1/shops/modeladen/status")).json()).toEqual({ open: true });
    expect(
      (await inject("GET", "/admin/v1/settings/general", undefined, { "x-test-shop": "b" })).json().version,
    ).toBe(0);
    // Nur-Lesen darf nicht speichern.
    expect(
      (
        await inject("PUT", "/admin/v1/settings/general", body, {
          "x-test-shop": "a-lesen",
          "if-match": '"1"',
        })
      ).statusCode,
    ).toBe(403);

    const reopened = await inject(
      "PUT",
      "/admin/v1/settings/general",
      { ...body, shopOpen: true },
      { ...asA, "if-match": '"1"' },
    );
    expect(reopened.json()).toMatchObject({ shopOpen: true, version: 2 });
    expect((await inject("GET", "/store/v1/shops/teeladen/status")).json()).toEqual({ open: true });
  });
});
