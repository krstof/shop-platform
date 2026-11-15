// E6 Teil 4 Ende zu Ende: Betreiber richtet Zwei-Faktor ein, meldet sich mit Passwort und Code an
// und erreicht erst dann die Platform-API. Echte Datenbank, echtes Anmeldemodul (shop_auth),
// Betreiberkonten gelesen als shop_app (neues Leserecht auf drei Spalten von platform.platform_user).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIdentityService,
  createMemberService,
  createMembershipDirectory,
  type IdentityService,
  type OutgoingMail,
} from "@shop/identity";
import { connectDatabase, createLogger, createSecretBox, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createOperatorDirectory, createShopAdministration, createShopDirectory } from "@shop/platform";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
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

const PLATFORM = "https://platform.localhost";
const PW = "Kaffeebohnen-im-Februar-42";
const OPERATOR = "betreiber@plattform.example";
const MERCHANT = "inhaberin@teeladen.example";

/** Code der Authenticator-App (RFC 6238), hier im Test nachgerechnet. */
async function appCode(secretBase32: string, stepOffset = 0): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const key: number[] = [];
  for (const ch of secretBase32) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const mac = createHmac("sha1", Buffer.from(key)).update(counter).digest();
  const o = (mac[mac.length - 1] ?? 0) & 0x0f;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe.skipIf(adminUrl === undefined)("Betreiber mit Zwei-Faktor und Platform-API (E6 Teil 4)", () => {
  const dbName = `api_platform_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let platformDatabase: Database<unknown>;
  const mails: OutgoingMail[] = [];
  let identity: IdentityService;
  let app: NestFastifyApplication;
  let operatorId: string;
  let secret = "";
  let backupCodes: string[] = [];
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

  const post = (url: string, body: unknown, cookie = "") =>
    inject({
      method: "POST",
      url,
      remoteAddress: "203.0.113.30",
      headers: { "content-type": "application/json", origin: PLATFORM, cookie },
      payload: JSON.stringify(body),
    });
  const get = (url: string, cookie: string) => inject({ method: "GET", url, headers: { cookie } });

  async function signIn(email = OPERATOR) {
    const r = await post("/auth/v1/sign-in", { email, password: PW });
    expect(r.statusCode).toBe(200);
    return { body: r.json(), cookie: String([r.headers["set-cookie"]].flat()[0]).split(";")[0] ?? "" };
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
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "api-platform-test",
    });
    const operators = createOperatorDirectory({ database });
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: PLATFORM,
      sessionKindOf: async (userId) =>
        (await operators.findOperator(userId)) === undefined ? "standard" : "operator",
    });
    operatorId = (await identity.createUser({ email: OPERATOR, password: PW })).userId;
    await identity.createUser({ email: MERCHANT, password: PW });
    // Betreiberkonto als Superuser anlegen (Plattform-Verwaltung dafür kommt mit E7).
    await inspect.query(`INSERT INTO platform.platform_user (user_id, role) VALUES ($1, 'owner')`, [
      operatorId,
    ]);

    const memberships = createMembershipDirectory({ database });
    const shops = createShopDirectory({ database });
    platformDatabase = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_platform"),
      maxConnections: 2,
      applicationName: "api-platform-test-admin",
    });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        identity,
        operators,
        platformShops: createShopAdministration({ database: platformDatabase }),
        members: createMemberService({
          database,
          identity,
          baseUrl: "https://admin.localhost",
          mailer: { send: async (mail) => void mails.push(mail) },
          shopName: async (id) => (await shops.getShops([id]))[0]?.name,
        }),
        shopsOfUser: shopsOfUser({ memberships, shops }),
      }),
      resolveActor: sessionResolver({ identity, memberships, shops, operators }),
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      rateLimiter: new RateLimiter(
        Object.fromEntries(
          Object.keys(DEFAULT_RATE_LIMITS).map((k) => [k, { limit: 1_000_000, windowMs: 60_000 }]),
        ) as typeof DEFAULT_RATE_LIMITS,
      ),
      allowedOrigins: [PLATFORM],
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await identity?.close();
    await database?.destroy();
    await platformDatabase?.destroy();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("shop_app liest von platform_user nur die drei nötigen Spalten", async () => {
    const r = await inspect.query(
      `SELECT has_column_privilege('shop_app', 'platform.platform_user', 'user_id', 'SELECT') AS uid,
              has_column_privilege('shop_app', 'platform.platform_user', 'created_by', 'SELECT') AS other,
              has_table_privilege('shop_app', 'platform.platform_user', 'INSERT,UPDATE,DELETE') AS write`,
    );
    expect(r.rows[0]).toEqual({ uid: true, other: false, write: false });
  });

  it("ohne Anmeldung 401, ohne Zwei-Faktor 403", async () => {
    expect((await get("/platform/v1/operator", "")).statusCode).toBe(401);
    const { body, cookie } = await signIn();
    expect(body.secondFactor).toBe("not_enrolled");
    // M8: Die Oberfläche erkennt das Betreiberkonto und bietet das Einrichten an.
    expect(body.platformOperator).toBe(true);
    const r = await get("/platform/v1/operator", cookie);
    expect(r.statusCode).toBe(403);
  });

  it("Einrichten: Passwort erneut, dann Code aus der App; danach 200 in der Platform-API", async () => {
    const { cookie } = await signIn();
    expect(
      (await post("/auth/v1/two-factor/setup", { password: "falsch-falsch-falsch" }, cookie)).statusCode,
    ).toBe(401);
    const setup = await post("/auth/v1/two-factor/setup", { password: PW }, cookie);
    expect(setup.statusCode).toBe(200);
    expect(setup.headers["cache-control"]).toBe("no-store");
    ({ secret, backupCodes } = setup.json() as { secret: string; backupCodes: string[] });
    expect(backupCodes).toHaveLength(10);

    const wrong = await post("/auth/v1/two-factor/enable", { code: "000000" }, cookie);
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().errors[0]).toMatchObject({ path: "/body/code", code: "invalid_code" });

    const enabled = await post("/auth/v1/two-factor/enable", { code: await appCode(secret) }, cookie);
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().secondFactor).toBe("verified");
    expect(enabled.json().platformOperator).toBe(true);

    const me = await get("/platform/v1/operator", cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ userId: operatorId, role: "owner" });
    expect((await post("/auth/v1/two-factor/setup", { password: PW }, cookie)).statusCode).toBe(409);
  });

  it("Anmelden mit Zwei-Faktor: erst Passwort (gilt nirgends), dann Code", async () => {
    const { body, cookie } = await signIn();
    expect(body.secondFactor).toBe("required");
    // Vor dem Code verrät die Antwort nichts über das Konto.
    expect(body.platformOperator).toBe(false);
    expect(body.shops).toEqual([]);
    expect((await get("/auth/v1/session", cookie)).statusCode).toBe(401);
    expect((await get("/platform/v1/operator", cookie)).statusCode).toBe(401);
    expect((await get("/admin/v1/manufacturers", cookie)).statusCode).toBe(401);

    // Code aus dem nächsten Zeitschritt (der aktuelle wurde schon beim Einschalten benutzt).
    const wrong = await post("/auth/v1/two-factor/verify", { code: "000000" }, cookie);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe("invalid_second_factor");
    const ok = await post("/auth/v1/two-factor/verify", { code: await appCode(secret, 1) }, cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().secondFactor).toBe("verified");
    expect((await get("/platform/v1/operator", cookie)).statusCode).toBe(200);
    expect((await post("/auth/v1/two-factor/verify", { code: "123456" }, cookie)).statusCode).toBe(409);
  });

  it("mit Ersatzcode anmelden geht genau einmal", async () => {
    const first = await signIn();
    const ok = await post("/auth/v1/two-factor/verify", { code: backupCodes[0] }, first.cookie);
    expect(ok.statusCode).toBe(200);
    const second = await signIn();
    expect(
      (await post("/auth/v1/two-factor/verify", { code: backupCodes[0] }, second.cookie)).statusCode,
    ).toBe(401);
  });

  it("nach 5 falschen Codes beginnt die Anmeldung von vorn", async () => {
    const { cookie } = await signIn();
    for (let i = 0; i < 4; i++)
      expect((await post("/auth/v1/two-factor/verify", { code: "000000" }, cookie)).json().code).toBe(
        "invalid_second_factor",
      );
    const last = await post("/auth/v1/two-factor/verify", { code: "000000" }, cookie);
    expect(last.statusCode).toBe(401);
    expect(last.json().code).toBe("unauthenticated");
  });

  it("Händler ohne Betreiberkonto erreicht die Platform-API nie", async () => {
    const { body, cookie } = await signIn(MERCHANT);
    expect(body.platformOperator).toBe(false);
    expect((await get("/auth/v1/session", cookie)).json().platformOperator).toBe(false);
    expect((await get("/platform/v1/operator", cookie)).statusCode).toBe(403);
  });

  it("deaktiviertes Betreiberkonto wirkt sofort", async () => {
    const first = await signIn();
    expect(
      (await post("/auth/v1/two-factor/verify", { code: backupCodes[1] }, first.cookie)).statusCode,
    ).toBe(200);
    await inspect.query(`UPDATE platform.platform_user SET status = 'disabled' WHERE user_id = $1`, [
      operatorId,
    ]);
    try {
      expect((await get("/platform/v1/operator", first.cookie)).statusCode).toBe(403);
    } finally {
      await inspect.query(`UPDATE platform.platform_user SET status = 'active' WHERE user_id = $1`, [
        operatorId,
      ]);
    }
  });

  it("Eingaben werden streng geprüft", async () => {
    const { cookie } = await signIn();
    expect((await post("/auth/v1/two-factor/verify", { code: "1".repeat(65) }, cookie)).statusCode).toBe(422);
    expect((await post("/auth/v1/two-factor/verify", { code: "123456", extra: 1 }, cookie)).statusCode).toBe(
      422,
    );
  });

  describe("Shops verwalten (M1)", () => {
    const OWNER = "inhaberin@modeladen.example";
    const OWNER_PW = "Leinenhemd-im-Sommer-77";
    let cookie = "";
    let shopId = "";

    const action = (url: string, c: string) =>
      inject({ method: "POST", url, headers: { origin: PLATFORM, cookie: c } });

    async function operatorCookie(code: string | undefined) {
      const first = await signIn();
      const ok = await post("/auth/v1/two-factor/verify", { code }, first.cookie);
      expect(ok.statusCode).toBe(200);
      return first.cookie;
    }

    it("Betreiber legt einen Shop an; die Inhaberin bekommt eine Einladung", async () => {
      cookie = await operatorCookie(backupCodes[2]);
      const r = await post(
        "/platform/v1/shops",
        { handle: "modeladen", name: "Modeladen", ownerEmail: OWNER },
        cookie,
      );
      expect(r.statusCode).toBe(201);
      const body = r.json();
      expect(body).toMatchObject({
        handle: "modeladen",
        name: "Modeladen",
        status: "active",
        ownerEmail: OWNER,
        invitationSent: true,
      });
      shopId = body.id;
      expect(mails.at(-1)?.to).toBe(OWNER);
      expect(mails.at(-1)?.subject).toContain("Modeladen");

      const list = await get("/platform/v1/shops", cookie);
      expect(list.statusCode).toBe(200);
      expect(list.json().data.map((s: { handle: string }) => s.handle)).toEqual(["modeladen"]);
    });

    it("gleicher Kurzname 409, ungültige Eingaben 422", async () => {
      const again = await post(
        "/platform/v1/shops",
        { handle: "modeladen", name: "Noch einer", ownerEmail: "x@y.example" },
        cookie,
      );
      expect(again.statusCode).toBe(409);
      // Kurznamen, die im Backoffice Seiten sind (M8), gibt es nicht als Shop.
      for (const handle of ["plattform", "anmelden", "einladung"])
        expect(
          (await post("/platform/v1/shops", { handle, name: "X", ownerEmail: "x@y.example" }, cookie))
            .statusCode,
        ).toBe(409);
      for (const body of [
        { handle: "Mode Laden", name: "X", ownerEmail: "x@y.example" },
        { handle: "ok-shop", name: "", ownerEmail: "x@y.example" },
        { handle: "ok-shop", name: "X", ownerEmail: "keine-adresse" },
      ])
        expect((await post("/platform/v1/shops", body, cookie)).statusCode).toBe(422);
    });

    it("Inhaberin nimmt an, meldet sich an und sieht ihren Shop", async () => {
      const code = /#code=([A-Za-z0-9_-]+)/.exec(mails.at(-1)?.text ?? "")?.[1];
      expect(code).toBeDefined();
      const accepted = await post("/auth/v1/invitations/accept", { code, password: OWNER_PW });
      expect(accepted.statusCode).toBe(200);
      const r = await post("/auth/v1/sign-in", { email: OWNER, password: OWNER_PW });
      expect(r.statusCode).toBe(200);
      expect(r.json().shops).toEqual([
        expect.objectContaining({ id: shopId, handle: "modeladen", role: "owner" }),
      ]);
      const ownerCookie = String([r.headers["set-cookie"]].flat()[0]).split(";")[0] ?? "";
      const team = await inject({
        method: "GET",
        url: "/admin/v1/members",
        headers: { cookie: ownerCookie, "shop-id": shopId },
      });
      expect(team.statusCode).toBe(200);
      expect(team.json().data).toEqual([
        expect.objectContaining({ email: OWNER, role: "owner", status: "active" }),
      ]);
    });

    it("gesperrter Shop ist für die Inhaberin weg, freigeschaltet wieder da", async () => {
      const suspended = await action(`/platform/v1/shops/${shopId}/suspend`, cookie);
      expect(suspended.statusCode).toBe(200);
      expect(suspended.json().status).toBe("suspended");
      const owner = await post("/auth/v1/sign-in", { email: OWNER, password: OWNER_PW });
      expect(owner.json().shops).toEqual([]);
      const ownerCookie = String([owner.headers["set-cookie"]].flat()[0]).split(";")[0] ?? "";
      const blocked = await inject({
        method: "GET",
        url: "/admin/v1/members",
        headers: { cookie: ownerCookie, "shop-id": shopId },
      });
      expect(blocked.statusCode).toBe(403);

      const back = await action(`/platform/v1/shops/${shopId}/reactivate`, cookie);
      expect(back.json().status).toBe("active");
      const again = await post("/auth/v1/sign-in", { email: OWNER, password: OWNER_PW });
      expect(again.json().shops).toHaveLength(1);
      expect((await action(`/platform/v1/shops/${randomUUID()}/suspend`, cookie)).statusCode).toBe(404);
    });

    it("nur Betreiber mit Zwei-Faktor und Schreibrecht", async () => {
      const merchant = await signIn(MERCHANT);
      expect((await get("/platform/v1/shops", merchant.cookie)).statusCode).toBe(403);
      await inspect.query(`UPDATE platform.platform_user SET role = 'viewer' WHERE user_id = $1`, [
        operatorId,
      ]);
      try {
        const viewer = await operatorCookie(backupCodes[3]);
        expect((await get("/platform/v1/shops", viewer)).statusCode).toBe(200);
        expect(
          (
            await post(
              "/platform/v1/shops",
              { handle: "teeladen", name: "T", ownerEmail: "a@b.example" },
              viewer,
            )
          ).statusCode,
        ).toBe(403);
      } finally {
        await inspect.query(`UPDATE platform.platform_user SET role = 'owner' WHERE user_id = $1`, [
          operatorId,
        ]);
      }
    });

    it("Kennzahlen aller Shops: Summen und je Shop, nur für Betreiber", async () => {
      // Zweiter Shop ohne Bestellungen; im ersten zwei bezahlte (heute 25 €, vor 3 Tagen 10 €) und eine offene Zahlung.
      const second = await post(
        "/platform/v1/shops",
        { handle: "buchladen", name: "Buchladen", ownerEmail: "inhaber@buchladen.example" },
        cookie,
      );
      expect(second.statusCode).toBe(201);
      for (const [total, status, daysAgo] of [
        [2500, "open", 0],
        [1000, "completed", 3],
        [700, "pending_payment", 0],
      ] as const)
        await inspect.query(
          `WITH c AS (INSERT INTO shop_settings.sales_channel (tenant_id, code, kind, name)
                      VALUES ($1, $2, 'storefront', 'Test') RETURNING id)
           INSERT INTO orders."order" (tenant_id, order_number, channel_id, email, locale, currency, tax_display,
                                       subtotal_amount, tax_amount, total_amount, status, payment_status, placed_at)
           SELECT $1, $2, c.id, 'k@example.org', 'de', 'EUR', 'gross', $3, 0, $3, $4,
                  CASE WHEN $4 = 'pending_payment' THEN 'unpaid' ELSE 'paid' END,
                  now() - make_interval(days => $5) FROM c`,
          [shopId, `p-${randomBytes(4).toString("hex")}`, total, status, daysAgo],
        );
      const r = await get("/platform/v1/stats", cookie);
      expect(r.statusCode).toBe(200);
      const stats = r.json();
      expect(stats).toMatchObject({
        currency: "EUR",
        shops: 2,
        activeShops: 2,
        suspendedShops: 0,
        toShip: 1,
        awaitingPayment: 1,
        truncated: false,
      });
      expect(stats.days).toHaveLength(7);
      expect(stats.days.at(-1)).toMatchObject({ orders: 1, revenue: 2500 });
      expect(stats.days.reduce((n: number, d: { revenue: number }) => n + d.revenue, 0)).toBe(3500);
      expect(stats.perShop).toEqual([
        { id: shopId, ordersToday: 1, revenueToday: 2500, orders7d: 2, revenue7d: 3500, toShip: 1 },
        { id: second.json().id, ordersToday: 0, revenueToday: 0, orders7d: 0, revenue7d: 0, toShip: 0 },
      ]);
      const merchant = await signIn(MERCHANT);
      expect((await get("/platform/v1/stats", merchant.cookie)).statusCode).toBe(403);
      expect((await get("/platform/v1/stats", "")).statusCode).toBe(401);
    });
  });
});
