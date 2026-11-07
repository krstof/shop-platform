// Zwei-Faktor gegen eine echte Datenbank (E6 Teil 4, Sicherheit 5.2, ADR-011): einrichten,
// anmelden mit Code und mit Ersatzcode, Schutz gegen Wiederverwenden, Raten und Verfall, strengere
// Sitzungsregeln für Betreiber. Better Auth läuft wie im Betrieb als Rolle shop_auth.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSecretBox } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIdentityService,
  LOGIN_THROTTLE_RULES,
  LoginThrottle,
  MAX_SECOND_FACTOR_FAILURES,
  type IdentityService,
  type TwoFactorSetup,
} from "./index.js";
import { totpCode, totpStep } from "./internal/totp.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const LOGIN_PW = "Kaffeebohnen-im-Februar-42";
const OPERATOR = "betreiber@plattform.example";
const MERCHANT = "inhaberin@teeladen.example";
const MINUTE = 60_000;

function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const cookieOf = (setCookie: string) => setCookie.split(";")[0] ?? "";

describe.skipIf(adminUrl === undefined)("Zwei-Faktor (echte Datenbank)", () => {
  const dbName = `identity_2fa_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let identity: IdentityService;
  /** Uhr des Moduls; Tests schieben sie vor, um Fristen zu prüfen. */
  let offset = 0;
  const now = () => Date.now() + offset;
  const operators = new Set<string>();
  let operatorId: string;
  let merchantId: string;
  let secret: Buffer;
  let setup: TwoFactorSetup;

  /** Code der App für die aktuelle (vorgeschobene) Zeit, optional einige Schritte weiter. */
  const code = (steps = 0) => totpCode(secret, totpStep(now()) + steps);

  async function signIn(email = OPERATOR) {
    const r = await identity.signIn({ email, password: LOGIN_PW, ipAddress: "203.0.113.7" });
    if (!r.ok) throw new Error(`Anmeldung fehlgeschlagen: ${r.reason}`);
    // Die Datenbank stempelt mit der echten Uhr; hier auf die vorgeschobene Uhr des Tests setzen.
    await inspect.query(`UPDATE identity.session SET created_at = $2, last_seen_at = $2 WHERE id = $1`, [
      r.sessionId,
      new Date(now()),
    ]);
    return { ...r, cookie: cookieOf(r.setCookie) };
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
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: "https://platform.localhost",
      now,
      sessionKindOf: async (userId) => (operators.has(userId) ? "operator" : "standard"),
      loginThrottle: new LoginThrottle({
        ...LOGIN_THROTTLE_RULES,
        freeFailures: 1000,
        lockAfterFailures: 2000,
      }),
    });
    operatorId = (await identity.createUser({ email: OPERATOR, password: LOGIN_PW })).userId;
    merchantId = (await identity.createUser({ email: MERCHANT, password: LOGIN_PW })).userId;
    operators.add(operatorId);
  }, 120_000);

  afterAll(async () => {
    await identity?.close();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe("Einrichten", () => {
    let cookie: string;
    let otherCookie: string;

    it("ohne Zwei-Faktor gilt die Sitzung sofort (not_enrolled)", async () => {
      const s = await signIn();
      expect(s.secondFactorRequired).toBe(false);
      cookie = s.cookie;
      otherCookie = (await signIn()).cookie;
      expect((await identity.getSession(cookie))?.secondFactor).toBe("not_enrolled");
    });

    it("verlangt das Passwort erneut", async () => {
      const r = await identity.startTwoFactorSetup({ cookie, password: "falsch-falsch-falsch" });
      expect(r).toEqual({ ok: false, reason: "invalid_password" });
      expect(await identity.startTwoFactorSetup({ cookie: undefined, password: LOGIN_PW })).toEqual({
        ok: false,
        reason: "no_session",
      });
    });

    it("liefert Geheimnis, QR-Inhalt und 10 Ersatzcodes; gespeichert wird nur verschlüsselt", async () => {
      const r = await identity.startTwoFactorSetup({ cookie, password: LOGIN_PW });
      if (!r.ok) throw new Error(r.reason);
      setup = r.setup;
      secret = base32Decode(setup.secret);
      expect(secret).toHaveLength(20);
      expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
      expect(setup.backupCodes).toHaveLength(10);
      const row = await inspect.query(
        `SELECT secret_encrypted, backup_codes_encrypted, enabled_at FROM identity.two_factor WHERE user_id = $1`,
        [operatorId],
      );
      const stored = row.rows[0] as {
        secret_encrypted: Buffer;
        backup_codes_encrypted: Buffer;
        enabled_at: Date;
      };
      expect(stored.enabled_at).toBeNull();
      expect(stored.secret_encrypted.includes(secret)).toBe(false);
      expect(stored.secret_encrypted.toString("latin1")).not.toContain(setup.secret);
      expect(stored.backup_codes_encrypted.toString("latin1")).not.toContain(setup.backupCodes[0]);
      // Noch nicht eingeschaltet: Die Anmeldung braucht weiter keinen Code.
      expect((await identity.getSession(cookie))?.secondFactor).toBe("not_enrolled");
    });

    it("falscher Code schaltet nichts ein", async () => {
      const wrong = String((Number(code()) + 1) % 1_000_000).padStart(6, "0");
      expect(await identity.confirmTwoFactorSetup(cookie, wrong)).toEqual({
        ok: false,
        reason: "invalid_code",
      });
    });

    it("richtiger Code schaltet ein, bestätigt diese Sitzung und beendet alle anderen", async () => {
      const r = await identity.confirmTwoFactorSetup(cookie, code());
      expect(r.ok).toBe(true);
      expect((await identity.getSession(cookie))?.secondFactor).toBe("verified");
      expect(await identity.getSession(otherCookie)).toBeUndefined();
      const user = await inspect.query(`SELECT two_factor_enabled FROM identity."user" WHERE id = $1`, [
        operatorId,
      ]);
      expect(user.rows[0]).toEqual({ two_factor_enabled: true });
    });

    it("einmal eingeschaltet, lässt es sich nicht still neu einrichten", async () => {
      expect(await identity.startTwoFactorSetup({ cookie, password: LOGIN_PW })).toEqual({
        ok: false,
        reason: "already_enabled",
      });
      expect(await identity.confirmTwoFactorSetup(cookie, code())).toEqual({
        ok: false,
        reason: "already_enabled",
      });
    });

    it("eine begonnene Einrichtung verfällt nach 15 Minuten", async () => {
      const m = await signIn(MERCHANT);
      const r = await identity.startTwoFactorSetup({ cookie: m.cookie, password: LOGIN_PW });
      if (!r.ok) throw new Error(r.reason);
      const merchantSecret = base32Decode(r.setup.secret);
      offset += 16 * MINUTE;
      try {
        const c = totpCode(merchantSecret, totpStep(now()));
        expect(await identity.confirmTwoFactorSetup(m.cookie, c)).toEqual({ ok: false, reason: "no_setup" });
      } finally {
        offset -= 16 * MINUTE;
      }
      await inspect.query(`DELETE FROM identity.two_factor WHERE user_id = $1`, [merchantId]);
    });
  });

  describe("Anmelden mit zweitem Faktor", () => {
    it("nach dem Passwort wartet die Sitzung und gilt nirgends", async () => {
      const s = await signIn();
      expect(s.secondFactorRequired).toBe(true);
      expect(await identity.getSession(s.cookie)).toBeUndefined();
      // Wer die wartende Sitzung hat, kann auch keine Einrichtung beginnen.
      expect(await identity.startTwoFactorSetup({ cookie: s.cookie, password: LOGIN_PW })).toEqual({
        ok: false,
        reason: "no_session",
      });
    });

    it("der zuletzt benutzte Code gilt kein zweites Mal, der nächste schon", async () => {
      const s = await signIn();
      // Bei der Einrichtung wurde code() schon benutzt.
      expect(await identity.verifySecondFactor(s.cookie, code())).toEqual({
        ok: false,
        reason: "invalid_code",
      });
      offset += 30_000;
      const r = await identity.verifySecondFactor(s.cookie, code());
      expect(r.ok).toBe(true);
      expect((await identity.getSession(s.cookie))?.secondFactor).toBe("verified");
      expect(await identity.verifySecondFactor(s.cookie, code(1))).toEqual({
        ok: false,
        reason: "not_pending",
      });
    });

    it("zwei gleichzeitige Anmeldungen mit demselben Code: nur eine gilt", async () => {
      offset += 30_000;
      const [a, b] = [await signIn(), await signIn()];
      const c = code();
      const results = await Promise.all([
        identity.verifySecondFactor(a.cookie, c),
        identity.verifySecondFactor(b.cookie, c),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it("Codes zu weit in der Zukunft oder Vergangenheit gelten nicht", async () => {
      offset += 30_000;
      const s = await signIn();
      expect((await identity.verifySecondFactor(s.cookie, code(2))).ok).toBe(false);
      expect((await identity.verifySecondFactor(s.cookie, code(-2))).ok).toBe(false);
      expect((await identity.verifySecondFactor(s.cookie, code(1))).ok).toBe(true);
      offset += 60_000;
    });

    it("Ersatzcode gilt genau einmal", async () => {
      const backup = setup.backupCodes[0] ?? "";
      const first = await signIn();
      const r = await identity.verifySecondFactor(first.cookie, backup.toUpperCase());
      expect(r).toMatchObject({ ok: true, backupCodesLeft: 9 });
      const second = await signIn();
      expect(await identity.verifySecondFactor(second.cookie, backup)).toEqual({
        ok: false,
        reason: "invalid_code",
      });
    });

    it(`nach ${MAX_SECOND_FACTOR_FAILURES} falschen Codes ist die Sitzung beendet`, async () => {
      const s = await signIn();
      for (let i = 1; i < MAX_SECOND_FACTOR_FAILURES; i++)
        expect(await identity.verifySecondFactor(s.cookie, "000000")).toMatchObject({
          reason: "invalid_code",
        });
      expect(await identity.verifySecondFactor(s.cookie, "000000")).toEqual({
        ok: false,
        reason: "no_session",
      });
      // Auch der richtige Code hilft jetzt nicht mehr.
      offset += 30_000;
      expect(await identity.verifySecondFactor(s.cookie, code())).toEqual({
        ok: false,
        reason: "no_session",
      });
    });

    it("nach 10 Minuten ohne Code verfällt die wartende Sitzung", async () => {
      const s = await signIn();
      offset += 11 * MINUTE;
      expect(await identity.verifySecondFactor(s.cookie, code())).toEqual({
        ok: false,
        reason: "no_session",
      });
    });

    it("ohne Cookie oder mit gefälschtem Cookie gibt es nichts zu bestätigen", async () => {
      expect(await identity.verifySecondFactor(undefined, "123456")).toEqual({
        ok: false,
        reason: "no_session",
      });
      expect(await identity.verifySecondFactor("__Host-shop_session=gefaelscht.sig", "123456")).toEqual({
        ok: false,
        reason: "no_session",
      });
    });

    it("Konten ohne Zwei-Faktor brauchen keinen Code", async () => {
      const m = await signIn(MERCHANT);
      expect(m.secondFactorRequired).toBe(false);
      expect(await identity.verifySecondFactor(m.cookie, "123456")).toEqual({
        ok: false,
        reason: "not_pending",
      });
    });
  });

  describe("Sitzungsregeln für Betreiber (1 Stunde ohne Aktivität, höchstens 12 Stunden)", () => {
    async function verifiedOperatorSession() {
      offset += 30_000;
      const s = await signIn();
      const r = await identity.verifySecondFactor(s.cookie, code());
      expect(r.ok).toBe(true);
      return s.cookie;
    }

    it("nach mehr als 1 Stunde ohne Aktivität ist die Sitzung beendet", async () => {
      const cookie = await verifiedOperatorSession();
      offset += 59 * MINUTE;
      expect(await identity.getSession(cookie)).toBeDefined();
      offset += 61 * MINUTE;
      expect(await identity.getSession(cookie)).toBeUndefined();
    });

    it("auch mit Aktivität nach höchstens 12 Stunden", async () => {
      const cookie = await verifiedOperatorSession();
      for (let elapsed = 0; elapsed < 11.5 * 60; elapsed += 50) {
        offset += 50 * MINUTE;
        expect(await identity.getSession(cookie), `nach ${elapsed + 50} Minuten`).toBeDefined();
      }
      offset += 50 * MINUTE;
      expect(await identity.getSession(cookie)).toBeUndefined();
    });

    it("Händler behalten ihre Regel (eine Stunde Pause ist kein Problem)", async () => {
      const m = await signIn(MERCHANT);
      offset += 3 * 60 * MINUTE;
      expect(await identity.getSession(m.cookie)).toBeDefined();
    });
  });
});
