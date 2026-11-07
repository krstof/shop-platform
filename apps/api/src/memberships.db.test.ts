// E6 Teil 3 Ende zu Ende: Anmelden, Shop über die Kopfzeile Shop-Id wählen, Rolle aus der
// Mitgliedschaft. Echte Datenbank, echtes Anmeldemodul (shop_auth), Mitgliedschaften als shop_app.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIdentityService,
  createMembershipDirectory,
  type IdentityService,
  type MembershipDirectory,
} from "@shop/identity";
import { connectDatabase, createLogger, uuidv7, withUserTransaction, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createShopDirectory } from "@shop/platform";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { sql } from "kysely";
import type { InjectOptions } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionResolver, shopsOfUser } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints } from "./endpoints.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./rate-limit.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const ADMIN = "https://admin.localhost";
const PW = "Kaffeebohnen-im-Februar-42";
const SHOP_A = uuidv7(); // Teeladen, aktiv
const SHOP_B = uuidv7(); // Hemdenladen, aktiv, fremd
const SHOP_C = uuidv7(); // gesperrt

const EMAILS = {
  owner: "inhaberin@teeladen.example",
  staff: "mitarbeiter@teeladen.example",
  outsider: "inhaber@hemdenladen.example",
  invited: "eingeladen@teeladen.example",
  disabled: "ehemalig@teeladen.example",
} as const;
type Who = keyof typeof EMAILS;

describe.skipIf(adminUrl === undefined)("Mitgliedschaften und Rollen (E6 Teil 3, echte Datenbank)", () => {
  const dbName = `api_member_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let memberships: MembershipDirectory;
  let app: NestFastifyApplication;
  const users = {} as Record<Who, string>;
  const cookies = {} as Partial<Record<Who, string>>;
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

  async function signIn(who: Who) {
    const r = await inject({
      method: "POST",
      url: "/auth/v1/sign-in",
      remoteAddress: "203.0.113.20",
      headers: { "content-type": "application/json", origin: ADMIN },
      payload: JSON.stringify({ email: EMAILS[who], password: PW }),
    });
    expect(r.statusCode).toBe(200);
    const line = [r.headers["set-cookie"]].flat()[0];
    cookies[who] = String(line).split(";")[0] ?? "";
    return r;
  }

  const admin_ = (who: Who, method: "GET" | "POST", url: string, shop?: string, body?: unknown) =>
    inject({
      method,
      url,
      headers: {
        cookie: cookies[who] ?? "",
        ...(shop === undefined ? {} : { "shop-id": shop }),
        ...(body === undefined ? {} : { "content-type": "application/json", origin: ADMIN }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
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
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "api-member-test",
    });
    identity = createIdentityService({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: ADMIN,
    });
    for (const [who, email] of Object.entries(EMAILS) as [Who, string][])
      users[who] = (await identity.createUser({ email, password: PW })).userId;

    // Testdaten als Superuser (umgeht RLS); die API selbst arbeitet als shop_app.
    for (const [id, handle, status] of [
      [SHOP_A, "teeladen", "active"],
      [SHOP_B, "hemdenladen", "active"],
      [SHOP_C, "gesperrt", "suspended"],
    ] as const) {
      await inspect.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, initcap($2), $3 FROM m, platform.plan p WHERE p.is_default`,
        [id, handle, status],
      );
    }
    const member = (tenant: string, who: Who, role: string, status = "active") =>
      inspect.query(
        `INSERT INTO identity.membership (tenant_id, user_id, role_key, status) VALUES ($1, $2, $3, $4)`,
        [tenant, users[who], role, status],
      );
    await member(SHOP_A, "owner", "owner");
    await member(SHOP_C, "owner", "staff");
    await member(SHOP_A, "staff", "staff");
    await member(SHOP_B, "outsider", "owner");
    await member(SHOP_A, "invited", "staff", "invited");
    await member(SHOP_A, "disabled", "staff");
    await inspect.query(`UPDATE identity."user" SET status = 'disabled' WHERE id = $1`, [users.disabled]);

    memberships = createMembershipDirectory({ database });
    const shops = createShopDirectory({ database });
    app = await createApi({
      endpoints: allEndpoints({ database, identity, shopsOfUser: shopsOfUser({ memberships, shops }) }),
      resolveActor: sessionResolver({ identity, memberships, shops }),
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      rateLimiter: new RateLimiter(
        Object.fromEntries(
          Object.keys(DEFAULT_RATE_LIMITS).map((k) => [k, { limit: 1_000_000, windowMs: 60_000 }]),
        ) as typeof DEFAULT_RATE_LIMITS,
      ),
      allowedOrigins: [ADMIN],
    });
    for (const who of ["owner", "staff", "outsider", "invited"] as const) await signIn(who);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await identity?.close();
    await database?.destroy();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe("„Wer bin ich“ und Anmelden zeigen die Shops", () => {
    it("Anmelden liefert die Shops gleich mit, nur aktive Shops", async () => {
      const r = await signIn("owner");
      expect(r.json().shops).toEqual([{ id: SHOP_A, handle: "teeladen", name: "Teeladen", role: "owner" }]);
    });

    it.each([
      ["owner", [[SHOP_A, "owner"]]],
      ["staff", [[SHOP_A, "staff"]]],
      ["outsider", [[SHOP_B, "owner"]]],
      ["invited", []],
    ] as const)("%s sieht genau seine Shops", async (who, expected) => {
      const r = await inject({
        method: "GET",
        url: "/auth/v1/session",
        headers: { cookie: cookies[who] ?? "" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().shops.map((s: { id: string; role: string }) => [s.id, s.role])).toEqual(expected);
    });
  });

  describe("Shop-Id wählt den Shop, die Mitgliedschaft entscheidet", () => {
    it("Inhaberin mit eigener Shop-Id: lesen 200, anlegen 201 im eigenen Shop", async () => {
      expect((await admin_("owner", "GET", "/admin/v1/manufacturers", SHOP_A)).statusCode).toBe(200);
      const c = await admin_("owner", "POST", "/admin/v1/manufacturers", SHOP_A, { name: "Teehaus Hamburg" });
      expect(c.statusCode).toBe(201);
      const { rows } = await inspect.query(
        `SELECT tenant_id, created_by FROM catalog.manufacturer WHERE id = $1`,
        [c.json().id],
      );
      // Shop aus der Mitgliedschaft, Urheber ist das Konto der Inhaberin.
      expect(rows).toEqual([{ tenant_id: SHOP_A, created_by: users.owner }]);
    });

    it("Mitarbeiter: Hersteller anlegen und Änderungsprotokoll lesen erlaubt", async () => {
      const c = await admin_("staff", "POST", "/admin/v1/manufacturers", SHOP_A, { name: "Kräuterhof" });
      expect(c.statusCode).toBe(201);
      expect((await admin_("staff", "GET", "/admin/v1/audit-entries", SHOP_A)).statusCode).toBe(200);
    });

    it.each([
      ["ohne Shop-Id", "owner", undefined],
      ["fremder Shop", "owner", SHOP_B],
      ["gesperrter Shop trotz Mitgliedschaft", "owner", SHOP_C],
      ["erfundener Shop", "owner", uuidv7()],
      ["nur eingeladen, noch nicht beigetreten", "invited", SHOP_A],
      ["fremder Inhaber im Teeladen", "outsider", SHOP_A],
    ] as const)("%s: 403, und zwar immer dieselbe Antwort", async (_name, who, shop) => {
      const r = await admin_(who, "GET", "/admin/v1/manufacturers", shop);
      expect(r.statusCode).toBe(403);
      expect({ ...r.json(), requestId: "" }).toMatchObject({ code: "forbidden", status: 403 });
      // Kein Hinweis, ob es den Shop gibt.
      expect(r.body).not.toContain("hemdenladen");
      expect(r.body).not.toMatch(/gesperrt|suspended/i);
    });

    it("ohne Sitzung hilft auch die richtige Shop-Id nicht: 401", async () => {
      const r = await inject({
        method: "GET",
        url: "/admin/v1/manufacturers",
        headers: { "shop-id": SHOP_A },
      });
      expect(r.statusCode).toBe(401);
    });

    it("jeder sieht nur die Hersteller seines Shops", async () => {
      await admin_("outsider", "POST", "/admin/v1/manufacturers", SHOP_B, { name: "Hemdenwerk" });
      const a = await admin_("owner", "GET", "/admin/v1/manufacturers", SHOP_A);
      const b = await admin_("outsider", "GET", "/admin/v1/manufacturers", SHOP_B);
      const names = (r: typeof a) =>
        r
          .json()
          .data.map((m: { name: string }) => m.name)
          .sort();
      expect(names(a)).toEqual(["Kräuterhof", "Teehaus Hamburg"]);
      expect(names(b)).toEqual(["Hemdenwerk"]);
    });
  });

  describe("Mitgliedschaften in der Datenbank (RLS über kernel.current_user_id)", () => {
    it("ein Konto sieht ohne Shop nur seine eigenen Mitgliedschaften", async () => {
      const visible = await withUserTransaction(database, users.owner, (trx) =>
        sql<{ user_id: string }>`select user_id from identity.membership`.execute(trx),
      );
      expect(new Set(visible.rows.map((r) => r.user_id))).toEqual(new Set([users.owner]));
      expect(visible.rows).toHaveLength(2);
    });

    it("eingeladene Mitgliedschaften und deaktivierte Konten zählen nicht", async () => {
      expect(await memberships.listMemberships(users.invited)).toEqual([]);
      expect(await memberships.listMemberships(users.disabled)).toEqual([]);
      expect(await memberships.findMembership(users.disabled, SHOP_A)).toBeUndefined();
    });

    it("eigene Rollen (custom) geben in Welle 1 keine Rechte", async () => {
      const role = await inspect.query(
        `INSERT INTO identity.role (tenant_id, key, name) VALUES ($1, 'lager', 'Lager') RETURNING id`,
        [SHOP_B],
      );
      await inspect.query(
        `INSERT INTO identity.membership (tenant_id, user_id, role_key, role_id) VALUES ($1, $2, 'custom', $3)`,
        [SHOP_B, users.staff, role.rows[0].id],
      );
      expect(await memberships.findMembership(users.staff, SHOP_B)).toBeUndefined();
      const r = await admin_("staff", "GET", "/admin/v1/manufacturers", SHOP_B);
      expect(r.statusCode).toBe(403);
    });

    it("shop_app kann keine Mitgliedschaft ohne Shop anlegen (RLS WITH CHECK)", async () => {
      await expect(
        withUserTransaction(database, users.outsider, (trx) =>
          sql`insert into identity.membership (tenant_id, user_id, role_key) values (${SHOP_A}, ${users.outsider}, 'staff')`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});
