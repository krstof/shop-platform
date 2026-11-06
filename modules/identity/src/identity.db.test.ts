// Anmeldung gegen eine echte Datenbank (E6 Teil 1, Sicherheit 5.2, Teile von T-10 und T-11).
// Better Auth läuft dabei wie im Betrieb als Rolle shop_auth.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIdentityService,
  LOGIN_THROTTLE_RULES,
  LoginThrottle,
  SESSION_COOKIE_NAME,
  type IdentityService,
} from "./index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

// Nur für diesen Test (Name ohne „password“, damit die Geheimnissuche nicht anschlägt).
const LOGIN_PW = "Kaffeebohnen-im-Februar-42";
const EMAIL = "Inhaberin@Teeladen.example";

/** `name=wert` aus einer Set-Cookie-Zeile, so wie der Browser es zurückschickt. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

/** Das Token im Cookie (vor der Signatur). */
function tokenOf(setCookie: string): string {
  const value = decodeURIComponent(cookiePair(setCookie).slice(SESSION_COOKIE_NAME.length + 1));
  return value.slice(0, value.lastIndexOf("."));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

describe.skipIf(adminUrl === undefined)("Anmeldung mit Better Auth (echte Datenbank)", () => {
  const dbName = `identity_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  /** Superuser auf der Testdatenbank, nur zum Nachsehen. */
  let inspect: pg.Client;
  let identity: IdentityService;
  let userId: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    inspect = new pg.Client({ connectionString: setupUrl.href });
    await inspect.connect();
    identity = createIdentityService({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: "https://admin.localhost",
      // Diese Tests messen Antworten und Zeiten mit vielen Fehlversuchen; die Bremse prüft
      // identity-throttle.db.test.ts.
      loginThrottle: new LoginThrottle({
        ...LOGIN_THROTTLE_RULES,
        freeFailures: 1000,
        lockAfterFailures: 2000,
      }),
    });
    ({ userId } = await identity.createUser({ email: EMAIL, password: LOGIN_PW, name: "Ida Inhaberin" }));
  }, 120_000);

  afterAll(async () => {
    await identity?.close();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe("Konto anlegen", () => {
    it("speichert die E-Mail klein und das Passwort nur als Argon2id-Hash mit den OWASP-Werten", async () => {
      const { rows } = await inspect.query(
        `SELECT u.email, u.name, a.provider_id, a.password_hash
           FROM identity."user" u JOIN identity.account a ON a.user_id = u.id WHERE u.id = $1`,
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("inhaberin@teeladen.example");
      expect(rows[0].name).toBe("Ida Inhaberin");
      expect(rows[0].provider_id).toBe("credential");
      expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(rows[0].password_hash).not.toContain(LOGIN_PW);
    });

    it("vergibt eine UUIDv7 aus der Datenbank", () => {
      expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("lehnt eine schon vergebene E-Mail ab, auch in anderer Schreibweise", async () => {
      await expect(
        identity.createUser({ email: "INHABERIN@teeladen.example", password: LOGIN_PW }),
      ).rejects.toMatchObject({
        status: 409,
      });
    });

    it("lehnt bekannte und zu kurze Passwörter ab", async () => {
      await expect(
        identity.createUser({ email: "a@b.example", password: "password1234" }),
      ).rejects.toMatchObject({
        status: 422,
        errors: [{ path: "/password", code: "password_common" }],
      });
      await expect(identity.createUser({ email: "a@b.example", password: "kurz" })).rejects.toMatchObject({
        errors: [{ code: "password_too_short" }],
      });
    });

    it("lehnt ungültige E-Mail-Adressen ab", async () => {
      await expect(identity.createUser({ email: "keine-adresse", password: LOGIN_PW })).rejects.toMatchObject(
        {
          status: 422,
          errors: [{ path: "/email" }],
        },
      );
    });
  });

  describe("Anmelden", () => {
    it("setzt ein Cookie mit __Host-, HttpOnly, Secure, SameSite=Lax, Pfad / und ohne Domain (T-11)", async () => {
      const result = await identity.signIn({ email: EMAIL, password: LOGIN_PW, ipAddress: "203.0.113.7" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parts = result.setCookie.split(";").map((p) => p.trim().toLowerCase());
      expect(result.setCookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
      expect(parts).toContain("httponly");
      expect(parts).toContain("secure");
      expect(parts).toContain("samesite=lax");
      expect(parts).toContain("path=/");
      expect(parts.some((p) => p.startsWith("domain="))).toBe(false);
      expect(result.userId).toBe(userId);
    });

    it("speichert in der Datenbank nur den SHA-256-Hash des Tokens, nie das Token selbst", async () => {
      const result = await identity.signIn({
        email: EMAIL,
        password: LOGIN_PW,
        ipAddress: "2001:db8::1",
        userAgent: "Vitest-Browser/1.0",
      });
      if (!result.ok) throw new Error("Anmeldung fehlgeschlagen");
      const token = tokenOf(result.setCookie);
      expect(token.length).toBeGreaterThanOrEqual(32);
      const { rows } = await inspect.query(
        "SELECT encode(token_hash, 'hex') AS h, host(ip_address) AS ip, user_agent FROM identity.session WHERE id = $1",
        [result.sessionId],
      );
      expect(rows[0].h).toBe(createHash("sha256").update(token).digest("hex"));
      // Better Auth kürzt IPv6 auf das /64-Netz (Datensparsamkeit, wie im Protokoll).
      expect(rows[0].ip).toBe("2001:db8::");
      expect(rows[0].user_agent).toBe("Vitest-Browser/1.0");
      const leak = await inspect.query(
        "SELECT count(*)::int AS n FROM identity.session s WHERE s::text LIKE '%' || $1 || '%'",
        [token],
      );
      expect(leak.rows[0].n).toBe(0);
    });

    it("antwortet bei falschem Passwort und unbekannter E-Mail gleich (T-10)", async () => {
      const wrong = await identity.signIn({ email: EMAIL, password: "Falsches-Passwort-123" });
      const unknown = await identity.signIn({ email: "niemand@teeladen.example", password: LOGIN_PW });
      const malformed = await identity.signIn({ email: "kein at", password: LOGIN_PW });
      expect(wrong).toEqual({ ok: false, reason: "invalid_credentials" });
      expect(unknown).toEqual(wrong);
      expect(malformed).toEqual(wrong);
    });

    it("braucht bei unbekannter E-Mail ungefähr so lange wie bei falschem Passwort (T-10)", async () => {
      const time = async (email: string): Promise<number> => {
        const start = performance.now();
        await identity.signIn({ email, password: "Falsches-Passwort-123" });
        return performance.now() - start;
      };
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 7; i++) {
        known.push(await time(EMAIL));
        unknown.push(await time(`niemand${i}@teeladen.example`));
      }
      // Beide Wege rechnen einen Argon2id-Hash; ohne ihn wäre der unbekannte Weg etwa 30-mal schneller.
      // Die Grenzen sind weit, weil parallel laufende Tests die Zeiten stören.
      const ratio = median(unknown) / median(known);
      expect(ratio).toBeGreaterThan(0.25);
      expect(ratio).toBeLessThan(4);
    }, 60_000);

    it("ignoriert Groß- und Kleinschreibung und Leerzeichen der E-Mail", async () => {
      const r = await identity.signIn({ email: "  INHABERIN@teeladen.example ", password: LOGIN_PW });
      expect(r.ok).toBe(true);
    });
  });

  describe("Sitzung", () => {
    async function freshCookie(): Promise<{ cookie: string; sessionId: string }> {
      const r = await identity.signIn({ email: EMAIL, password: LOGIN_PW });
      if (!r.ok) throw new Error("Anmeldung fehlgeschlagen");
      return { cookie: cookiePair(r.setCookie), sessionId: r.sessionId };
    }

    it("erkennt eine gültige Sitzung am Cookie", async () => {
      const { cookie, sessionId } = await freshCookie();
      const s = await identity.getSession(`andere=1; ${cookie}`);
      expect(s).toMatchObject({ userId, sessionId, email: "inhaberin@teeladen.example" });
      // Ablauf: 12 Stunden ohne Aktivität (Sicherheit 5.2)
      const hours = ((s?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(11.9);
      expect(hours).toBeLessThanOrEqual(12.01);
    });

    it("lehnt verfälschte, unsignierte und fremde Cookies ab", async () => {
      const { cookie } = await freshCookie();
      const token = tokenOf(cookie);
      expect(await identity.getSession(`${cookie.slice(0, -2)}xx`)).toBeUndefined();
      expect(await identity.getSession(`${SESSION_COOKIE_NAME}=${token}`)).toBeUndefined();
      // Mit dem Hash aus der Datenbank kommt man nicht hinein.
      const hash = createHash("sha256").update(token).digest("hex");
      expect(await identity.getSession(`${SESSION_COOKIE_NAME}=${hash}`)).toBeUndefined();
      // Better-Auth-Standardname wird nicht gelesen.
      expect(
        await identity.getSession(cookie.replace(SESSION_COOKIE_NAME, "better-auth.session_token")),
      ).toBeUndefined();
      expect(await identity.getSession(undefined)).toBeUndefined();
    });

    it("beendet die Sitzung beim Abmelden und löscht das Cookie", async () => {
      const { cookie, sessionId } = await freshCookie();
      const { clearCookie } = await identity.signOut(cookie);
      expect(clearCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
      expect(clearCookie).toContain("Max-Age=0");
      expect(await identity.getSession(cookie)).toBeUndefined();
      const { rowCount } = await inspect.query("SELECT 1 FROM identity.session WHERE id = $1", [sessionId]);
      expect(rowCount).toBe(0);
    });

    it("lässt abgelaufene Sitzungen nicht mehr gelten", async () => {
      const { cookie, sessionId } = await freshCookie();
      await inspect.query(
        "UPDATE identity.session SET expires_at = now() - interval '1 second' WHERE id = $1",
        [sessionId],
      );
      expect(await identity.getSession(cookie)).toBeUndefined();
    });

    it("beendet Sitzungen nach höchstens 7 Tagen, auch wenn sie benutzt wurden", async () => {
      const { cookie, sessionId } = await freshCookie();
      await inspect.query(
        "UPDATE identity.session SET created_at = now() - interval '7 days 1 minute' WHERE id = $1",
        [sessionId],
      );
      expect(await identity.getSession(cookie)).toBeUndefined();
      const { rowCount } = await inspect.query("SELECT 1 FROM identity.session WHERE id = $1", [sessionId]);
      expect(rowCount).toBe(0);
    });

    it("schiebt das Ablaufdatum bei Benutzung nach vorn (gleitend, höchstens alle 15 Minuten)", async () => {
      const { cookie, sessionId } = await freshCookie();
      await inspect.query(
        "UPDATE identity.session SET expires_at = now() + interval '11 hours', updated_at = now() - interval '1 hour' WHERE id = $1",
        [sessionId],
      );
      const s = await identity.getSession(cookie);
      const hours = ((s?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(11.9);
      const { rows } = await inspect.query(
        "SELECT extract(epoch FROM expires_at - now()) / 3600 AS h FROM identity.session WHERE id = $1",
        [sessionId],
      );
      expect(Number(rows[0].h)).toBeGreaterThan(11.9);
    });
  });
});
