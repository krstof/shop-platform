// T-10 und T-11 Ende zu Ende: Auth-API mit echtem Anmeldemodul (Better Auth als shop_auth) und
// echter Datenbank. Prüft, was ein Browser erlebt: Cookie, Sitzung, Abmelden, fremde Herkunft, Bremse.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIdentityService,
  LOGIN_THROTTLE_RULES,
  LoginThrottle,
  type IdentityService,
} from "@shop/identity";
import { connectDatabase, createLogger, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
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
const LOGIN_PW = "Kaffeebohnen-im-Februar-42";

function firstSetCookie(header: string | string[] | number | undefined): string {
  const line = Array.isArray(header) ? header[0] : header;
  if (typeof line !== "string") throw new Error("kein Set-Cookie");
  return line;
}

/** `name=wert`, so wie der Browser das Cookie zurückschickt. */
function pairOf(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

describe.skipIf(adminUrl === undefined)("Auth-API Ende zu Ende (echte Datenbank)", () => {
  const dbName = `api_auth_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let app: NestFastifyApplication;
  let t = Date.parse("2026-11-06T12:00:00Z");
  const now = () => t;
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

  const signIn = (email: string, password: string, ip = "203.0.113.10") =>
    inject({
      method: "POST",
      url: "/auth/v1/sign-in",
      remoteAddress: ip,
      headers: { "content-type": "application/json", origin: ADMIN, "user-agent": "Vitest-Browser/1.0" },
      payload: JSON.stringify({ email, password }),
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
      maxConnections: 2,
      applicationName: "api-auth-test",
    });
    identity = createIdentityService({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: ADMIN,
      loginThrottle: new LoginThrottle(LOGIN_THROTTLE_RULES, now),
      now,
    });
    await identity.createUser({ email: EMAIL, password: LOGIN_PW });
    app = await createApi({
      endpoints: allEndpoints({ database, identity }),
      resolveActor: sessionResolver(identity),
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      // Die allgemeine Bremse (5 Anmeldungen je Minute) prüft auth.test.ts; hier geht es um die eigene.
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
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe("T-11: Cookie und Sitzung", () => {
    it("Anmelden setzt __Host-shop_session mit HttpOnly, Secure, SameSite=Lax, Pfad / und ohne Domain", async () => {
      const r = await signIn(EMAIL, LOGIN_PW);
      expect(r.statusCode).toBe(200);
      const line = firstSetCookie(r.headers["set-cookie"]);
      const attrs = line.split(";").map((p) => p.trim().toLowerCase());
      expect(line.startsWith("__Host-shop_session=")).toBe(true);
      expect(attrs).toEqual(expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/"]));
      expect(attrs.some((a) => a.startsWith("domain="))).toBe(false);
      expect(r.json().user.email).toBe(EMAIL);
      // Das Token steht nicht im Inhalt der Antwort.
      const token = pairOf(line).split("=")[1] ?? "";
      expect(r.body).not.toContain(decodeURIComponent(token).split(".")[0]);
    });

    it("mit dem Cookie: „Wer bin ich“ 200; nach dem Abmelden gilt dasselbe Cookie nicht mehr", async () => {
      const cookie = pairOf(firstSetCookie((await signIn(EMAIL, LOGIN_PW)).headers["set-cookie"]));
      const me = await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.email).toBe(EMAIL);

      const out = await inject({
        method: "POST",
        url: "/auth/v1/sign-out",
        headers: { cookie, origin: ADMIN },
      });
      expect(out.statusCode).toBe(200);
      expect(firstSetCookie(out.headers["set-cookie"])).toMatch(/^__Host-shop_session=;.*Max-Age=0/);
      // Ein gestohlenes Cookie ist nach dem Abmelden wertlos (B-04): Die Sitzung ist in der Datenbank weg.
      const again = await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie } });
      expect(again.statusCode).toBe(401);
    });

    it("eine neue Anmeldung im selben Browser beendet die alte Sitzung (neue Sitzungs-ID)", async () => {
      const first = pairOf(firstSetCookie((await signIn(EMAIL, LOGIN_PW)).headers["set-cookie"]));
      const r = await inject({
        method: "POST",
        url: "/auth/v1/sign-in",
        headers: { "content-type": "application/json", origin: ADMIN, cookie: first },
        payload: JSON.stringify({ email: EMAIL, password: LOGIN_PW }),
      });
      const second = pairOf(firstSetCookie(r.headers["set-cookie"]));
      expect(second).not.toBe(first);
      expect(
        (await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie: first } })).statusCode,
      ).toBe(401);
      expect(
        (await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie: second } })).statusCode,
      ).toBe(200);
    });

    it("verfälschtes Cookie: 401", async () => {
      const cookie = pairOf(firstSetCookie((await signIn(EMAIL, LOGIN_PW)).headers["set-cookie"]));
      const forged = `${cookie.slice(0, -3)}abc`;
      const r = await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie: forged } });
      expect(r.statusCode).toBe(401);
    });

    it("fremde Herkunft wird abgelehnt, auch mit gültigem Cookie, und die Sitzung bleibt bestehen", async () => {
      const cookie = pairOf(firstSetCookie((await signIn(EMAIL, LOGIN_PW)).headers["set-cookie"]));
      const out = await inject({
        method: "POST",
        url: "/auth/v1/sign-out",
        headers: { cookie, origin: "https://evil.example" },
      });
      expect(out.statusCode).toBe(403);
      expect(out.json().code).toBe("cross_origin_rejected");
      const create = await inject({
        method: "POST",
        url: "/admin/v1/manufacturers",
        headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
        payload: JSON.stringify({ name: "Untergeschoben GmbH" }),
      });
      expect(create.statusCode).toBe(403);
      expect(create.json().code).toBe("cross_origin_rejected");
      expect((await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie } })).statusCode).toBe(
        200,
      );
      const { rows } = await inspect.query("SELECT count(*)::int AS n FROM catalog.manufacturer");
      expect(rows[0].n).toBe(0);
    });

    it("angemeldet ohne Mitgliedschaft: Admin-API 403 (Rollen folgen in E6 Teil 3)", async () => {
      const cookie = pairOf(firstSetCookie((await signIn(EMAIL, LOGIN_PW)).headers["set-cookie"]));
      const r = await inject({ method: "GET", url: "/admin/v1/manufacturers", headers: { cookie } });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("T-10: Bremse über HTTP", () => {
    it("bekannte und unbekannte E-Mail: dieselben Antworten, ab dem 6. Versuch 429 mit Retry-After", async () => {
      const run = async (email: string, ip: string) => {
        const seen: string[] = [];
        for (let i = 0; i < 7; i++) {
          const r = await signIn(email, "Falsches-Passwort-123", ip);
          seen.push(`${r.statusCode} ${r.json().code} ${String(r.headers["retry-after"] ?? "-")}`);
        }
        return seen;
      };
      const known = await run(EMAIL, "198.51.100.20");
      const unknown = await run("niemand@teeladen.example", "198.51.100.21");
      expect(known).toEqual(unknown);
      expect(known).toEqual([
        ...Array<string>(5).fill("401 invalid_credentials -"),
        "429 rate_limited 1",
        "429 rate_limited 1",
      ]);
    });

    it("nach Ablauf der Wartezeit klappt das richtige Passwort", async () => {
      t += 2_000;
      const r = await signIn(EMAIL, LOGIN_PW, "198.51.100.22");
      expect(r.statusCode).toBe(200);
    });
  });
});
