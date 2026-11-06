// T-10 mit echter Datenbank: Bremse und Sperre der Anmeldung (Sicherheit 5.2, B-03).
// Die Uhr ist gestellt, damit 15 Minuten Sperre nicht 15 Minuten Testzeit kosten.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIdentityService, LOGIN_THROTTLE_RULES, LoginThrottle, type IdentityService } from "./index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const LOGIN_PW = "Kaffeebohnen-im-Februar-42";
const WRONG_PW = "Falsches-Passwort-123";

describe.skipIf(adminUrl === undefined)("T-10: Bremse und Sperre der Anmeldung (echte Datenbank)", () => {
  const dbName = `identity_throttle_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let t = Date.parse("2026-11-06T12:00:00Z");
  const now = () => t;
  const advance = (seconds: number) => {
    t += seconds * 1000;
  };
  let connection = "";
  let secret = "";
  const services: IdentityService[] = [];

  function service(): IdentityService {
    const s = createIdentityService({
      connectionString: connection,
      secret,
      baseUrl: "https://admin.localhost",
      loginThrottle: new LoginThrottle(LOGIN_THROTTLE_RULES, now),
      now,
    });
    services.push(s);
    return s;
  }

  /** 20 Fehlversuche; wartet jeweils die verlangte Zeit ab. Liefert die Folge der Ergebnisse. */
  async function twentyFailures(
    identity: IdentityService,
    email: string,
    ipAddress: string,
  ): Promise<string[]> {
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      let r = await identity.signIn({ email, password: WRONG_PW, ipAddress });
      if (!r.ok && r.reason === "throttled") {
        seen.push(`warten ${r.retryAfterSeconds}`);
        advance(r.retryAfterSeconds);
        r = await identity.signIn({ email, password: WRONG_PW, ipAddress });
      }
      seen.push(r.ok ? "ok" : r.reason);
    }
    return seen;
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
    connection = roleUrl(adminUrl ?? "", dbName, "shop_auth");
    secret = randomBytes(32).toString("base64url");
    const setup = service();
    await setup.createUser({ email: "inhaberin@teeladen.example", password: LOGIN_PW });
    await setup.createUser({ email: "mitarbeiter@teeladen.example", password: LOGIN_PW });
  }, 120_000);

  afterAll(async () => {
    for (const s of services) await s.close();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("bekanntes und unbekanntes Konto durchlaufen genau dieselbe Folge von Antworten", async () => {
    const unknown = await twentyFailures(service(), "niemand@teeladen.example", "198.51.100.2");
    const known = await twentyFailures(service(), "inhaberin@teeladen.example", "198.51.100.1");
    expect(known).toEqual(unknown);
    expect(known.filter((s) => s.startsWith("warten"))).toEqual([
      "warten 1",
      "warten 2",
      "warten 4",
      "warten 8",
      "warten 16",
      "warten 32",
      ...Array<string>(9).fill("warten 60"),
    ]);
    expect(known.filter((s) => s === "invalid_credentials")).toHaveLength(20);
  }, 120_000);

  it("schreibt die Sperre in identity.user.locked_until und lässt auch das richtige Passwort nicht durch", async () => {
    const { rows } = await inspect.query(
      `SELECT locked_until FROM identity."user" WHERE email = 'inhaberin@teeladen.example'`,
    );
    // Die Uhr steht noch beim 20. Fehlversuch des bekannten Kontos.
    expect(new Date(rows[0].locked_until).getTime()).toBe(t + 15 * 60 * 1000);
    const r = await service().signIn({
      email: "inhaberin@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "192.0.2.50",
    });
    expect(r).toEqual({ ok: false, reason: "throttled", retryAfterSeconds: 900 });
    // Andere Konten sind nicht betroffen.
    const other = await service().signIn({
      email: "mitarbeiter@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "192.0.2.50",
    });
    expect(other.ok).toBe(true);
  });

  it("die Sperre übersteht einen Neustart (neuer Dienst ohne Zähler im Speicher)", async () => {
    advance(10 * 60);
    const fresh = service();
    const r = await fresh.signIn({
      email: "inhaberin@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "192.0.2.51",
    });
    expect(r).toEqual({ ok: false, reason: "throttled", retryAfterSeconds: 300 });
  });

  it("nach Ablauf der Sperre klappt die Anmeldung wieder", async () => {
    advance(5 * 60);
    const r = await service().signIn({
      email: "inhaberin@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "192.0.2.52",
    });
    expect(r.ok).toBe(true);
  });

  it("ein Netz, das viele Konten durchprobiert, wird gebremst, aber nie gesperrt", async () => {
    const identity = service();
    for (let i = 0; i < 30; i++) {
      const r = await identity.signIn({
        email: `k${i}@x.example`,
        password: WRONG_PW,
        ipAddress: "2001:db8:aa::1",
      });
      if (!r.ok && r.reason === "throttled") {
        advance(r.retryAfterSeconds);
        await identity.signIn({ email: `k${i}@x.example`, password: WRONG_PW, ipAddress: "2001:db8:aa::1" });
      }
    }
    // Richtiges Passwort, anderes Konto, neue Adresse im selben /64: erst warten (höchstens 60 s) ...
    const r = await identity.signIn({
      email: "mitarbeiter@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "2001:db8:aa::ffff",
    });
    expect(r).toEqual({ ok: false, reason: "throttled", retryAfterSeconds: 60 });
    // ... dann klappt es: Kollegen hinter derselben Adresse werden nicht 15 Minuten ausgesperrt.
    advance(60);
    const after = await identity.signIn({
      email: "mitarbeiter@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "2001:db8:aa::ffff",
    });
    expect(after.ok).toBe(true);
    // Das Konto selbst ist nicht gesperrt: aus einem anderen Netz geht es.
    const elsewhere = await identity.signIn({
      email: "mitarbeiter@teeladen.example",
      password: LOGIN_PW,
      ipAddress: "2001:db8:bb::1",
    });
    expect(elsewhere.ok).toBe(true);
    const { rows } = await inspect.query(
      `SELECT locked_until FROM identity."user" WHERE email = 'mitarbeiter@teeladen.example'`,
    );
    expect(rows[0].locked_until).toBeNull();
  }, 120_000);
});
