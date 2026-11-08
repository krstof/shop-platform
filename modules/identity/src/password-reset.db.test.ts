// „Passwort vergessen“ gegen eine echte Datenbank (E6 Teil 6, Sicherheit 5.2, ADR-013).
// Better Auth läuft wie im Betrieb als Rolle shop_auth; E-Mails landen in einer Liste.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, createSecretBox } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIdentityService,
  LOGIN_THROTTLE_RULES,
  LoginThrottle,
  ResetMailLimiter,
  type IdentityService,
  type MailSender,
  type OutgoingMail,
} from "./index.js";
import { hashResetCode } from "./internal/password-reset.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const OLD_PW = "Kaffeebohnen-im-Februar-42";
const NEW_PW = "Teeblaetter-im-November-17";
const OTHER_PW = "Ganz-anderes-Kennwort-99";
const MINUTE = 60_000;

const cookieOf = (setCookie: string) => setCookie.split(";")[0] ?? "";

/** Der Code aus dem Link in der E-Mail. */
function codeIn(mail: OutgoingMail | undefined): string {
  const match = /#code=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "");
  if (match?.[1] === undefined) throw new Error("kein Link in der E-Mail");
  return match[1];
}

describe.skipIf(adminUrl === undefined)("Passwort vergessen (echte Datenbank)", () => {
  const dbName = `identity_reset_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let identity: IdentityService;
  let offset = 0;
  const now = () => Date.now() + offset;
  const mails: OutgoingMail[] = [];
  let failMail = false;
  const mailer: MailSender = {
    async send(mail) {
      if (failMail)
        throw Object.assign(new Error("550 Empfänger ida@teeladen.example unbekannt"), { code: "EENVELOPE" });
      mails.push(mail);
    },
  };
  const logLines: string[] = [];
  let seq = 0;

  /** Legt ein frisches Konto an (jeder Test sein eigenes, damit die Zählung nicht stört). */
  async function newAccount(extra: { locale?: string } = {}) {
    const email = `konto${++seq}@teeladen.example`;
    const { userId } = await identity.createUser({ email, password: OLD_PW, name: `Ida ${seq}` });
    if (extra.locale !== undefined)
      await inspect.query(`UPDATE identity."user" SET locale = $2 WHERE id = $1`, [userId, extra.locale]);
    return { email, userId };
  }

  async function requestCode(email: string): Promise<string> {
    const before = mails.length;
    await identity.requestPasswordReset({ email }).done;
    expect(mails).toHaveLength(before + 1);
    return codeIn(mails.at(-1));
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
      baseUrl: "https://admin.localhost",
      mailer,
      now,
      resetMailLimiter: new ResetMailLimiter(now),
      loginThrottle: new LoginThrottle(LOGIN_THROTTLE_RULES, now),
      logger: createLogger({
        level: "info",
        destination: { write: (line: string) => void logLines.push(line) },
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await identity?.close();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    failMail = false;
  });

  it("schickt für ein bekanntes Konto eine E-Mail und speichert nur den Hash des Codes", async () => {
    const { email, userId } = await newAccount();
    const code = await requestCode(email.toUpperCase());
    const mail = mails.at(-1);
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe("Passwort zurücksetzen");
    expect(mail?.text).toContain(`https://admin.localhost/passwort-neu#code=${code}`);
    const { rows } = await inspect.query(
      `SELECT identifier, value_hash, purpose, expires_at, created_at FROM identity.verification WHERE identifier = $1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("password_reset");
    expect(Buffer.from(rows[0].value_hash).equals(hashResetCode(code))).toBe(true);
    expect(rows[0].value_hash.toString("utf8")).not.toContain(code);
    expect(rows[0].expires_at.getTime() - rows[0].created_at.getTime()).toBe(30 * MINUTE);
  });

  it("schreibt auf Englisch, wenn das Konto Englisch eingestellt hat", async () => {
    const { email } = await newAccount({ locale: "en" });
    await requestCode(email);
    expect(mails.at(-1)?.subject).toBe("Reset your password");
  });

  it("macht bei unbekannter E-Mail, ungültiger Eingabe und deaktiviertem Konto nichts", async () => {
    const before = mails.length;
    const {
      rows: [{ n: rowsBefore }],
    } = await inspect.query(`SELECT count(*)::int AS n FROM identity.verification`);
    await identity.requestPasswordReset({ email: "niemand@teeladen.example" }).done;
    await identity.requestPasswordReset({ email: "keine adresse" }).done;
    const { email, userId } = await newAccount();
    await inspect.query(`UPDATE identity."user" SET status = 'disabled' WHERE id = $1`, [userId]);
    await identity.requestPasswordReset({ email }).done;
    expect(mails).toHaveLength(before);
    const {
      rows: [{ n: rowsAfter }],
    } = await inspect.query(`SELECT count(*)::int AS n FROM identity.verification`);
    expect(rowsAfter).toBe(rowsBefore);
  });

  it("antwortet sofort: Der Aufruf wartet weder auf Datenbank noch auf E-Mail", async () => {
    const { email } = await newAccount();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow: MailSender = {
      send: async (m) => {
        await gate;
        mails.push(m);
      },
    };
    const original = mailer.send;
    mailer.send = slow.send;
    try {
      const started = performance.now();
      const { done } = identity.requestPasswordReset({ email });
      expect(performance.now() - started).toBeLessThan(20);
      let finished = false;
      void done.then(() => (finished = true));
      await new Promise((r) => setTimeout(r, 50));
      expect(finished).toBe(false);
      release();
      await done;
      expect(finished).toBe(true);
    } finally {
      mailer.send = original;
    }
  });

  it("setzt mit dem Code ein neues Passwort, beendet alle Sitzungen und meldet nicht an", async () => {
    const { email, userId } = await newAccount();
    const a = await identity.signIn({ email, password: OLD_PW });
    const b = await identity.signIn({ email, password: OLD_PW });
    if (!a.ok || !b.ok) throw new Error("Anmeldung fehlgeschlagen");
    const code = await requestCode(email);

    expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({ ok: true });

    expect(await identity.getSession(cookieOf(a.setCookie))).toBeUndefined();
    expect(await identity.getSession(cookieOf(b.setCookie))).toBeUndefined();
    const { rows } = await inspect.query(
      `SELECT count(*)::int AS n FROM identity.session WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0].n).toBe(0);
    expect((await identity.signIn({ email, password: OLD_PW })).ok).toBe(false);
    expect((await identity.signIn({ email, password: NEW_PW })).ok).toBe(true);
    const user = await inspect.query(`SELECT email_verified FROM identity."user" WHERE id = $1`, [userId]);
    expect(user.rows[0].email_verified).toBe(true);
  });

  it("lässt jeden Code nur einmal gelten, auch bei zwei gleichzeitigen Anfragen", async () => {
    const { email } = await newAccount();
    const code = await requestCode(email);
    const results = await Promise.all([
      identity.resetPassword({ code, newPassword: NEW_PW }),
      identity.resetPassword({ code, newPassword: OTHER_PW }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "invalid_code")).toHaveLength(1);
    expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({
      ok: false,
      reason: "invalid_code",
    });
  });

  it("verwirft den Code nach 30 Minuten", async () => {
    const { email } = await newAccount();
    const code = await requestCode(email);
    offset += 30 * MINUTE;
    try {
      expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({
        ok: false,
        reason: "invalid_code",
      });
    } finally {
      offset -= 30 * MINUTE;
    }
  });

  it("ersetzt einen alten Code durch einen neuen und räumt abgelaufene Codes auf", async () => {
    const { email, userId } = await newAccount();
    const first = await requestCode(email);
    const second = await requestCode(email);
    expect(await identity.resetPassword({ code: first, newPassword: NEW_PW })).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    const { rows } = await inspect.query(
      `SELECT count(*)::int AS n FROM identity.verification WHERE identifier = $1`,
      [userId],
    );
    expect(rows[0].n).toBe(1);
    await inspect.query(
      `INSERT INTO identity.verification (identifier, value_hash, purpose, expires_at, created_at)
       VALUES ('alt', $1, 'password_reset', now() - interval '1 hour', now() - interval '2 hours')`,
      [randomBytes(32)],
    );
    await requestCode((await newAccount()).email);
    const stale = await inspect.query(
      `SELECT count(*)::int AS n FROM identity.verification WHERE identifier = 'alt'`,
    );
    expect(stale.rows[0].n).toBe(0);
    expect(await identity.resetPassword({ code: second, newPassword: NEW_PW })).toEqual({ ok: true });
  });

  it("lehnt ein zu schwaches Passwort ab, ohne den Code zu verbrauchen", async () => {
    const { email } = await newAccount();
    const code = await requestCode(email);
    expect(await identity.resetPassword({ code, newPassword: "kurz" })).toMatchObject({
      ok: false,
      reason: "weak_password",
      problem: "too_short",
    });
    expect(await identity.resetPassword({ code, newPassword: `${email}-und-mehr` })).toMatchObject({
      reason: "weak_password",
      problem: "contains_email",
    });
    expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({ ok: true });
  });

  it("lehnt Codes in falscher Form und fremde Codes gleich ab", async () => {
    for (const code of ["", "x", "a".repeat(43), "ä".repeat(43), randomBytes(32).toString("base64url")]) {
      expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({
        ok: false,
        reason: "invalid_code",
      });
    }
  });

  it("verschickt höchstens 3 E-Mails je Konto in 15 Minuten", async () => {
    const { email } = await newAccount();
    const before = mails.length;
    for (let i = 0; i < 5; i++) await identity.requestPasswordReset({ email }).done;
    expect(mails.length - before).toBe(3);
    offset += 15 * MINUTE;
    try {
      await identity.requestPasswordReset({ email }).done;
      expect(mails.length - before).toBe(4);
    } finally {
      offset -= 15 * MINUTE;
    }
  });

  it("hebt eine Sperre nach Fehlversuchen auf", async () => {
    const { email } = await newAccount();
    for (let i = 0; i < LOGIN_THROTTLE_RULES.lockAfterFailures; i++) {
      // Die Wartezeit der Bremse überspringen, damit jeder Versuch zählt.
      offset += 61_000;
      await identity.signIn({ email, password: "Falsches-Passwort-123" });
    }
    const locked = await inspect.query(`SELECT locked_until FROM identity."user" WHERE email = $1`, [email]);
    expect(locked.rows[0].locked_until).not.toBeNull();
    expect(await identity.signIn({ email, password: OLD_PW })).toMatchObject({
      ok: false,
      reason: "throttled",
    });

    const code = await requestCode(email);
    expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({ ok: true });
    const after = await inspect.query(`SELECT locked_until FROM identity."user" WHERE email = $1`, [email]);
    expect(after.rows[0].locked_until).toBeNull();
    expect((await identity.signIn({ email, password: NEW_PW })).ok).toBe(true);
  });

  it("umgeht Zwei-Faktor nicht: Nach dem neuen Passwort wartet die Anmeldung wieder auf den Code", async () => {
    const { email, userId } = await newAccount();
    // Zwei-Faktor wie nach der Einrichtung (two-factor.db.test.ts prüft die Einrichtung selbst).
    await inspect.query(`UPDATE identity."user" SET two_factor_enabled = true WHERE id = $1`, [userId]);
    const code = await requestCode(email);
    expect(await identity.resetPassword({ code, newPassword: NEW_PW })).toEqual({ ok: true });
    const r = await identity.signIn({ email, password: NEW_PW });
    if (!r.ok) throw new Error("Anmeldung fehlgeschlagen");
    expect(r.secondFactorRequired).toBe(true);
    // Die Sitzung gilt nirgends, solange der Code fehlt.
    expect(await identity.getSession(cookieOf(r.setCookie))).toBeUndefined();
    const tf = await inspect.query(`SELECT two_factor_enabled FROM identity."user" WHERE id = $1`, [userId]);
    expect(tf.rows[0].two_factor_enabled).toBe(true);
  });

  it("schreibt bei einem Versandfehler weder Adresse noch Fehlertext ins Protokoll", async () => {
    const { email } = await newAccount();
    failMail = true;
    logLines.length = 0;
    await identity.requestPasswordReset({ email }).done;
    const log = logLines.join("\n");
    expect(log).toContain("Hintergrund gescheitert");
    expect(log).toContain("EENVELOPE");
    expect(log).not.toContain("teeladen.example");
    expect(log).not.toContain("550");
  });

  it("protokolliert nie den Code", async () => {
    logLines.length = 0;
    const { email } = await newAccount();
    const code = await requestCode(email);
    await identity.resetPassword({ code, newPassword: NEW_PW });
    expect(logLines.join("\n")).not.toContain(code);
  });
});
