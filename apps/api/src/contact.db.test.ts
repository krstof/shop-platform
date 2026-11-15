// Kontaktformular (Storefront-API) und Posteingang (Admin-API), Modul customers; je Shop getrennt.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createShopDirectory } from "@shop/platform";
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
    scopes: new Set(shop === "a-lesen" ? ["customers:read"] : ["customers:read", "customers:write"]),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Kontaktformular und Posteingang (echte Datenbank)", () => {
  const dbName = `api_contact_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, shop = "a") =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { "x-test-shop": shop },
        ...(payload === undefined ? {} : { payload }),
      });

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
      [TENANT_A, "teeladen"],
      [TENANT_B, "modeladen"],
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
      maxConnections: 4,
      applicationName: "api-contact-test",
    });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
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

  it("Besucher schreibt, Posteingang zeigt ungelesen, markieren, löschen; anderer Shop sieht nichts", async () => {
    const nachricht = {
      name: "Kim Muster",
      email: "kim@example.org",
      subject: "Frage zum Sencha",
      message: "Hallo,\r\nist der Sencha auch in 250 g zu haben?",
    };
    // Öffentlich, ohne Anmeldung
    const r = await inject("POST", "/store/v1/shops/teeladen/contact-messages", nachricht, "keiner");
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ received: true });
    const ohneBetreff = await inject(
      "POST",
      "/store/v1/shops/teeladen/contact-messages",
      { name: "Jo", email: "jo@example.org", message: "Danke!" },
      "keiner",
    );
    expect(ohneBetreff.statusCode).toBe(201);
    // Falsche E-Mail, leerer Text, fremdes Feld, unbekannter Shop
    for (const falsch of [
      { ...nachricht, email: "kein-at" },
      { ...nachricht, message: "   " },
      { ...nachricht, extra: 1 },
    ])
      expect(
        (await inject("POST", "/store/v1/shops/teeladen/contact-messages", falsch, "keiner")).statusCode,
      ).toBe(422);
    expect(
      (await inject("POST", "/store/v1/shops/gibtsnicht/contact-messages", nachricht, "keiner")).statusCode,
    ).toBe(404);

    const liste = (await inject("GET", "/admin/v1/contact-messages")).json();
    expect(liste.unread).toBe(2);
    expect(liste.data.map((m: { name: string }) => m.name)).toEqual(["Jo", "Kim Muster"]);
    expect(liste.data[1]).toMatchObject({
      subject: "Frage zum Sencha",
      message: "Hallo,\nist der Sencha auch in 250 g zu haben?",
      read: false,
    });
    expect(liste.data[0].subject).toBe("");
    const kim = liste.data[1].id as string;

    // Shop B sieht und ändert nichts
    expect((await inject("GET", "/admin/v1/contact-messages", undefined, "b")).json()).toEqual({
      data: [],
      unread: 0,
    });
    expect((await inject("PATCH", `/admin/v1/contact-messages/${kim}`, { read: true }, "b")).statusCode).toBe(
      404,
    );
    expect((await inject("DELETE", `/admin/v1/contact-messages/${kim}`, undefined, "b")).statusCode).toBe(
      404,
    );
    // Nur lesen darf nicht markieren
    expect(
      (await inject("PATCH", `/admin/v1/contact-messages/${kim}`, { read: true }, "a-lesen")).statusCode,
    ).toBe(403);

    const gelesen = await inject("PATCH", `/admin/v1/contact-messages/${kim}`, { read: true });
    expect(gelesen.statusCode).toBe(200);
    expect(gelesen.json().read).toBe(true);
    expect((await inject("PATCH", `/admin/v1/contact-messages/${kim}`, { read: true })).json().read).toBe(
      true,
    );
    expect((await inject("GET", "/admin/v1/contact-messages")).json().unread).toBe(1);
    expect((await inject("PATCH", `/admin/v1/contact-messages/${kim}`, { read: false })).json().read).toBe(
      false,
    );
    expect((await inject("DELETE", `/admin/v1/contact-messages/${kim}`)).statusCode).toBe(200);
    expect((await inject("DELETE", `/admin/v1/contact-messages/${kim}`)).statusCode).toBe(404);
    const danach = (await inject("GET", "/admin/v1/contact-messages")).json();
    expect(danach.data).toHaveLength(1);
    expect(danach.unread).toBe(1);
  });
});
