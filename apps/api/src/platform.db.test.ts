// E6 Teil 4 Ende zu Ende: Betreiber richtet Zwei-Faktor ein, meldet sich mit Passwort und Code an
// und erreicht erst dann die Platform-API. Echte Datenbank, echtes Anmeldemodul (shop_auth),
// Betreiberkonten gelesen als shop_app (neues Leserecht auf drei Spalten von platform.platform_user).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdentityService, createMembershipDirectory, type IdentityService } from "@shop/identity";
import { connectDatabase, createLogger, createSecretBox, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createOperatorDirectory, createShopDirectory } from "@shop/platform";
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
    app = await createApi({
      endpoints: allEndpoints({
        database,
        identity,
        operators,
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

    const me = await get("/platform/v1/operator", cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ userId: operatorId, role: "owner" });
    expect((await post("/auth/v1/two-factor/setup", { password: PW }, cookie)).statusCode).toBe(409);
  });

  it("Anmelden mit Zwei-Faktor: erst Passwort (gilt nirgends), dann Code", async () => {
    const { body, cookie } = await signIn();
    expect(body.secondFactor).toBe("required");
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
    const { cookie } = await signIn(MERCHANT);
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
});
