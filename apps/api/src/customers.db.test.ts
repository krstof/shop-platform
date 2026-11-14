// Kundenkarten per Hand (Modul customers): anlegen, auflisten, löschen; je Shop getrennt.
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

describe.skipIf(adminUrl === undefined)("Kundenkarten (echte Datenbank)", () => {
  const dbName = `api_customers_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;
  const inject = (method: "GET" | "POST" | "DELETE", url: string, payload?: object, shop = "a") =>
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
      applicationName: "api-customers-test",
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
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  it("legt an, listet mit Adresse, lehnt doppelte E-Mail ab, löscht; anderer Shop sieht nichts", async () => {
    const kim = {
      email: "Kim@Example.org",
      firstName: "Kim",
      lastName: "Muster",
      phone: "040 123",
      address: { street: "Teeweg 1", postalCode: "20095", city: "Hamburg" },
    };
    const r = await inject("POST", "/admin/v1/customer-profiles", kim);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ email: "Kim@Example.org", phone: "040 123", address: kim.address });
    const ohne = await inject("POST", "/admin/v1/customer-profiles", {
      email: "jo@example.org",
      firstName: "Jo",
      lastName: "Beispiel",
    });
    expect(ohne.json().address).toBeNull();
    expect(
      (await inject("POST", "/admin/v1/customer-profiles", { ...kim, email: "kim@example.org" })).statusCode,
    ).toBe(409);
    expect(
      (
        await inject("POST", "/admin/v1/customer-profiles", {
          ...kim,
          address: { ...kim.address, postalCode: "1" },
        })
      ).statusCode,
    ).toBe(422);
    const list = (await inject("GET", "/admin/v1/customer-profiles")).json().data;
    expect(list.map((c: { email: string }) => c.email)).toEqual(["jo@example.org", "Kim@Example.org"]);
    expect((await inject("GET", "/admin/v1/customer-profiles", undefined, "b")).json().data).toEqual([]);
    expect(
      (await inject("DELETE", `/admin/v1/customer-profiles/${r.json().id}`, undefined, "b")).statusCode,
    ).toBe(404);
    expect((await inject("POST", "/admin/v1/customer-profiles", kim, "a-lesen")).statusCode).toBe(403);
    expect((await inject("DELETE", `/admin/v1/customer-profiles/${r.json().id}`)).statusCode).toBe(200);
    expect((await inject("GET", "/admin/v1/customer-profiles")).json().data).toHaveLength(1);
  });
});
