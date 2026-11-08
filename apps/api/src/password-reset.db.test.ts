// „Passwort vergessen“ Ende zu Ende (E6 Teil 6, PLA-04, Sicherheit 5.2, ADR-013): Auth-API mit
// echtem Anmeldemodul (Better Auth als shop_auth) und echter Datenbank. E-Mails landen in einer Liste.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIdentityService,
  createMembershipDirectory,
  type IdentityService,
  type OutgoingMail,
} from "@shop/identity";
import { connectDatabase, createLogger, createSecretBox, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createShopDirectory } from "@shop/platform";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionResolver } from "./actor.js";
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
const EMAIL = "inhaberin@teeladen.example";
const OLD_PW = "Kaffeebohnen-im-Februar-42";
const NEW_PW = "Teeblaetter-im-November-17";

function codeIn(mail: OutgoingMail | undefined): string {
  const match = /#code=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "");
  if (match?.[1] === undefined) throw new Error("kein Link in der E-Mail");
  return match[1];
}

describe.skipIf(adminUrl === undefined)("Passwort vergessen über die Auth-API (echte Datenbank)", () => {
  const dbName = `api_reset_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let app: NestFastifyApplication;
  const mails: OutgoingMail[] = [];
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    inject({
      method: "POST",
      url,
      remoteAddress: "203.0.113.10",
      headers: { "content-type": "application/json", origin: ADMIN, ...headers },
      payload: JSON.stringify(body),
    });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 2,
      applicationName: "api-reset-test",
    });
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: ADMIN,
      mailer: { send: async (m) => void mails.push(m) },
    });
    await identity.createUser({ email: EMAIL, password: OLD_PW });
    app = await createApi({
      endpoints: allEndpoints({ database, identity }),
      resolveActor: sessionResolver({
        identity,
        memberships: createMembershipDirectory({ database }),
        shops: createShopDirectory({ database }),
        operators: { findOperator: async () => undefined },
      }),
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      rateLimiter: new RateLimiter(
        Object.fromEntries(
          Object.keys(DEFAULT_RATE_LIMITS).map((k) => [k, { limit: 1_000_000, windowMs: 60_000 }]),
        ) as typeof DEFAULT_RATE_LIMITS,
      ),
      allowedOrigins: [ADMIN],
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await identity?.close();
    await database?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  /** Wartet, bis der Hintergrund eine E-Mail geschickt hat (höchstens 5 s). */
  async function nextMail(before: number): Promise<OutgoingMail> {
    for (let i = 0; i < 100 && mails.length === before; i++) await new Promise((r) => setTimeout(r, 50));
    const mail = mails[before];
    if (mail === undefined) throw new Error("keine E-Mail angekommen");
    return mail;
  }

  it("antwortet für bekannte und unbekannte Adressen gleich", async () => {
    const before = mails.length;
    const known = await post("/auth/v1/password/forgot", { email: EMAIL });
    const unknown = await post("/auth/v1/password/forgot", { email: "niemand@teeladen.example" });
    for (const r of [known, unknown]) {
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ accepted: true });
      expect(r.headers["set-cookie"]).toBeUndefined();
    }
    expect(known.body).toBe(unknown.body);
    await nextMail(before);
    await new Promise((r) => setTimeout(r, 200));
    expect(mails.slice(before).map((m) => m.to)).toEqual([EMAIL]);
  });

  it("setzt mit dem Code aus der E-Mail ein neues Passwort; die alte Sitzung gilt nicht mehr", async () => {
    const signIn = await post("/auth/v1/sign-in", { email: EMAIL, password: OLD_PW });
    expect(signIn.statusCode).toBe(200);
    const cookie = (String(signIn.headers["set-cookie"]).split(";")[0] ?? "").trim();

    const before = mails.length;
    await post("/auth/v1/password/forgot", { email: EMAIL });
    const code = codeIn(await nextMail(before));

    const weak = await post("/auth/v1/password/reset", { code, newPassword: "zu-kurz" });
    expect(weak.statusCode).toBe(422);
    expect(weak.json().errors[0]).toMatchObject({ path: "/body/newPassword", code: "password_too_short" });

    const reset = await post("/auth/v1/password/reset", { code, newPassword: NEW_PW });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ passwordChanged: true });
    expect(reset.headers["set-cookie"]).toBeUndefined();

    const session = await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie } });
    expect(session.statusCode).toBe(401);
    expect((await post("/auth/v1/sign-in", { email: EMAIL, password: OLD_PW })).statusCode).toBe(401);
    expect((await post("/auth/v1/sign-in", { email: EMAIL, password: NEW_PW })).statusCode).toBe(200);

    const again = await post("/auth/v1/password/reset", { code, newPassword: NEW_PW });
    expect(again.statusCode).toBe(422);
    expect(again.json().errors[0]).toMatchObject({ path: "/body/code", code: "invalid_reset_code" });
    expect(again.json().errors[0].message).toContain("neuen anfordern");
  });

  it("nennt den Fehler auf Englisch, wenn der Browser Englisch möchte", async () => {
    const r = await post(
      "/auth/v1/password/reset",
      { code: randomBytes(32).toString("base64url"), newPassword: NEW_PW },
      { "accept-language": "en" },
    );
    expect(r.statusCode).toBe(422);
    expect(r.json().errors[0].message).toContain("request a new one");
  });

  it("lehnt Anfragen von fremden Seiten ab (CSRF) und unbekannte Felder", async () => {
    const foreign = await post(
      "/auth/v1/password/forgot",
      { email: EMAIL },
      { origin: "https://boese.example" },
    );
    expect(foreign.statusCode).toBe(403);
    const extra = await post("/auth/v1/password/forgot", { email: EMAIL, redirect: "https://boese.example" });
    expect(extra.statusCode).toBe(422);
  });
});
