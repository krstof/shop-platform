// Mitarbeiter einladen, annehmen und entfernen gegen eine echte Datenbank (E6 Teil 7, SIC-03,
// Sicherheit 5.3, ADR-014). Läuft wie im Betrieb: Mitgliedschaften als shop_app, Konten und Codes
// als shop_auth. E-Mails landen in einer Liste.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDatabase, createLogger, createSecretBox, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createApiTokenService,
  createIdentityService,
  createMemberService,
  createMembershipDirectory,
  LoginThrottle,
  MAX_PENDING_INVITATIONS_PER_SHOP,
  ResetMailLimiter,
  type ApiTokenService,
  type IdentityService,
  type MemberService,
  type MembershipDirectory,
  type OutgoingMail,
} from "./index.js";
import { hashResetCode } from "./internal/password-reset.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const PW = "Kaffeebohnen-im-Februar-42";
const NEW_PW = "Teeblaetter-im-November-17";
const OTHER_PW = "Ganz-anderes-Kennwort-99";
const SHOP_A = uuidv7();
const SHOP_B = uuidv7();
const DAY = 86_400_000;

function codeIn(mail: OutgoingMail | undefined): string {
  const match = /#code=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "");
  if (match?.[1] === undefined) throw new Error("kein Link in der E-Mail");
  return match[1];
}

describe.skipIf(adminUrl === undefined)("Mitarbeiter einladen und entfernen (echte Datenbank)", () => {
  const dbName = `identity_members_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let members: MemberService;
  let memberships: MembershipDirectory;
  let tokens: ApiTokenService;
  let offset = 0;
  const now = () => Date.now() + offset;
  const mails: OutgoingMail[] = [];
  let failMail = false;
  const logLines: string[] = [];
  let owner: string;
  let ownerB: string;
  let seq = 0;
  const fresh = () => `person${++seq}-${randomBytes(3).toString("hex")}@teeladen.example`;

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
      maxConnections: 4,
      applicationName: "identity-members-test",
    });
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: "https://admin.localhost",
      loginThrottle: new LoginThrottle(undefined, now),
      now,
    });
    const logger = createLogger({
      level: "info",
      destination: { write: (line: string) => void logLines.push(line) },
    });
    members = createMemberService({
      database,
      identity,
      baseUrl: "https://admin.localhost",
      mailer: {
        async send(mail) {
          if (failMail)
            throw Object.assign(new Error(`550 Empfänger ${mail.to} unbekannt`), { code: "EENVELOPE" });
          mails.push(mail);
        },
      },
      shopName: async (id) => (id === SHOP_A ? "Teeladen Morgentau" : "Hemdenladen"),
      logger,
      // Großzügig; die Grenze selbst prüft ein eigener Test mit eigener Zählung.
      mailLimiter: new ResetMailLimiter(now, 1000, 900),
      now,
    });
    memberships = createMembershipDirectory({ database });
    tokens = createApiTokenService({ database, now });
    owner = (await identity.createUser({ email: "inhaberin@teeladen.example", password: PW })).userId;
    ownerB = (await identity.createUser({ email: "inhaber@hemdenladen.example", password: PW })).userId;
    for (const [id, handle] of [
      [SHOP_A, "teeladen"],
      [SHOP_B, "hemdenladen"],
    ] as const) {
      await inspect.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    await inspect.query(
      `INSERT INTO identity.membership (tenant_id, user_id, role_key) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [SHOP_A, owner, SHOP_B, ownerB],
    );
  }, 60_000);

  beforeEach(() => {
    offset = 0;
    failMail = false;
  });

  afterAll(async () => {
    await identity?.close();
    await database?.destroy();
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  async function invite(email: string, tenantId = SHOP_A, invitedBy = owner) {
    const before = mails.length;
    const r = await members.invite({ tenantId, invitedBy, email, role: "staff", locale: "de" });
    if (!r.ok) throw new Error(`Einladen fehlgeschlagen: ${r.reason}`);
    return { result: r, mail: mails[before], code: codeIn(mails[before]) };
  }

  /** Lädt ein, nimmt an und liefert die Konto-ID. */
  async function staffMember(email = fresh()) {
    const { code, result } = await invite(email);
    const accepted = await members.accept({ code, password: NEW_PW });
    if (!accepted.ok) throw new Error(`Annehmen fehlgeschlagen: ${accepted.reason}`);
    return { userId: result.member.userId, memberId: result.member.id, email };
  }

  const outboxTypes = async (since: Date) =>
    (
      await inspect.query<{ type: string }>(
        `SELECT type FROM kernel.outbox WHERE tenant_id = $1 AND occurred_at >= $2 ORDER BY id`,
        [SHOP_A, since],
      )
    ).rows.map((r) => r.type);

  it("neue Adresse: Konto ohne Passwort, Mitgliedschaft eingeladen, nur der Hash des Codes gespeichert", async () => {
    const email = fresh();
    const since = new Date();
    const { result, mail, code } = await invite(email);
    expect(result.invitationSent).toBe(true);
    expect(result.member).toMatchObject({ email, role: "staff", status: "invited", invitedBy: owner });
    const days = (result.invitationExpiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);

    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe("Einladung zum Shop „Teeladen Morgentau“");
    expect(mail?.text).toContain("https://admin.localhost/einladung#code=");
    expect(mail?.text).toContain("wählst ein Passwort");

    const { rows: accounts } = await inspect.query(`SELECT 1 FROM identity.account WHERE user_id = $1`, [
      result.member.userId,
    ]);
    expect(accounts).toEqual([]);
    const { rows: codes } = await inspect.query<{ identifier: string; value_hash: Buffer }>(
      `SELECT identifier, value_hash FROM identity.verification WHERE purpose = 'invitation' AND identifier = $1`,
      [`${SHOP_A}:${result.member.userId}`],
    );
    expect(codes).toHaveLength(1);
    expect(codes[0]?.value_hash.equals(hashResetCode(code))).toBe(true);
    expect(JSON.stringify(codes)).not.toContain(code);

    // Eingeladen zählt nirgends, und ohne Passwort kann sich niemand anmelden.
    expect(await memberships.listMemberships(result.member.userId)).toEqual([]);
    const signIn = await identity.signIn({ email, password: NEW_PW, ipAddress: "198.51.100.7" });
    expect(signIn).toEqual({ ok: false, reason: "invalid_credentials" });

    expect(await outboxTypes(since)).toEqual(["identity.member.invited.v1"]);
    const { rows: events } = await inspect.query<{ data: unknown }>(
      `SELECT data FROM kernel.outbox WHERE tenant_id = $1 AND type = 'identity.member.invited.v1' AND occurred_at >= $2`,
      [SHOP_A, since],
    );
    // Keine E-Mail-Adresse im Ereignis (das Änderungsprotokoll wird nie gelöscht).
    expect(JSON.stringify(events)).not.toContain("@");
  });

  it("annehmen: ohne Passwort 422, zu schwaches kostet den Code nicht, dann Konto mit Passwort und aktiv", async () => {
    const email = fresh();
    const { code, result } = await invite(email);
    expect(await members.accept({ code })).toEqual({ ok: false, reason: "password_required" });
    expect(await members.accept({ code, password: "zu kurz" })).toMatchObject({
      ok: false,
      reason: "weak_password",
      problem: "too_short",
    });
    expect(await members.accept({ code, password: `${email}-und-mehr` })).toMatchObject({
      reason: "weak_password",
      problem: "contains_email",
    });
    const accepted = await members.accept({ code, password: NEW_PW, name: "Jonas" });
    expect(accepted).toEqual({ ok: true, tenantId: SHOP_A, accountCreated: true });

    expect(await memberships.findMembership(result.member.userId, SHOP_A)).toEqual({
      tenantId: SHOP_A,
      role: "staff",
    });
    const { rows } = await inspect.query<{ name: string; email_verified: boolean; hash: string }>(
      `SELECT u.name, u.email_verified, a.password_hash AS hash FROM identity."user" u
         JOIN identity.account a ON a.user_id = u.id AND a.provider_id = 'credential' WHERE u.id = $1`,
      [result.member.userId],
    );
    expect(rows[0]?.name).toBe("Jonas");
    expect(rows[0]?.email_verified).toBe(true);
    expect(rows[0]?.hash.startsWith("$argon2id$")).toBe(true);
    const signIn = await identity.signIn({ email, password: NEW_PW, ipAddress: "198.51.100.7" });
    expect(signIn.ok).toBe(true);

    // Der Code gilt genau einmal und steht nicht mehr in der Tabelle.
    expect(await members.accept({ code, password: NEW_PW })).toEqual({ ok: false, reason: "invalid_code" });
    const { rows: left } = await inspect.query(`SELECT 1 FROM identity.verification WHERE value_hash = $1`, [
      hashResetCode(code),
    ]);
    expect(left).toEqual([]);
  });

  it("bestehendes Konto: kein Passwort nötig, ein mitgeschicktes ändert nichts, Name bleibt", async () => {
    await inspect.query(`UPDATE identity."user" SET name = 'Bernd' WHERE id = $1`, [ownerB]);
    const before = mails.length;
    const r = await members.invite({
      tenantId: SHOP_A,
      invitedBy: owner,
      email: "INHABER@hemdenladen.example",
      role: "staff",
      locale: "en",
    });
    expect(r.ok && r.member.userId).toBe(ownerB);
    const mail = mails[before];
    // Das Konto spricht Deutsch (Sprache des Kontos, nicht der einladenden Anfrage).
    expect(mail?.text).toContain("Dein Passwort bleibt, wie es ist.");
    const accepted = await members.accept({
      code: codeIn(mail),
      password: OTHER_PW,
      name: "X",
    });
    expect(accepted).toEqual({ ok: true, tenantId: SHOP_A, accountCreated: false });
    expect(
      (
        await identity.signIn({
          email: "inhaber@hemdenladen.example",
          password: PW,
          ipAddress: "198.51.100.8",
        })
      ).ok,
    ).toBe(true);
    expect(
      await identity.signIn({
        email: "inhaber@hemdenladen.example",
        password: OTHER_PW,
        ipAddress: "198.51.100.8",
      }),
    ).toEqual({ ok: false, reason: "invalid_credentials" });
    const { rows } = await inspect.query<{ name: string }>(`SELECT name FROM identity."user" WHERE id = $1`, [
      ownerB,
    ]);
    expect(rows[0]?.name).toBe("Bernd");
    // Jetzt in zwei Shops: Inhaber in B, Mitarbeiter in A.
    expect((await memberships.listMemberships(ownerB)).map((m) => [m.tenantId, m.role]).sort()).toEqual(
      [
        [SHOP_A, "staff"],
        [SHOP_B, "owner"],
      ].sort(),
    );
  });

  it("erneut einladen ersetzt den Code; schon Mitglied ergibt already_member", async () => {
    const email = fresh();
    const first = await invite(email);
    const second = await invite(email);
    expect(second.result.member.id).toBe(first.result.member.id);
    expect(await members.accept({ code: first.code, password: NEW_PW })).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    expect((await members.accept({ code: second.code, password: NEW_PW })).ok).toBe(true);
    const again = await members.invite({
      tenantId: SHOP_A,
      invitedBy: owner,
      email,
      role: "staff",
      locale: "de",
    });
    expect(again).toEqual({ ok: false, reason: "already_member" });
    const self = await members.invite({
      tenantId: SHOP_A,
      invitedBy: owner,
      email: "inhaberin@teeladen.example",
      role: "staff",
      locale: "de",
    });
    expect(self).toEqual({ ok: false, reason: "already_member" });
    expect(
      await members.invite({
        tenantId: SHOP_A,
        invitedBy: owner,
        email: "kein-at",
        role: "staff",
        locale: "de",
      }),
    ).toEqual({ ok: false, reason: "invalid_email" });
  });

  it("abgelaufene Einladung (7 Tage) gilt nicht mehr", async () => {
    const { code } = await invite(fresh());
    offset = 7 * DAY + 60_000;
    expect(await members.accept({ code, password: NEW_PW })).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("zwei gleichzeitige Annahmen mit demselben Code: genau eine gelingt", async () => {
    const { code, result } = await invite(fresh());
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => members.accept({ code, password: NEW_PW })),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const { rows } = await inspect.query(`SELECT 1 FROM identity.account WHERE user_id = $1`, [
      result.member.userId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("gleichzeitige Einladungen an dieselbe neue Adresse: ein Konto, eine Mitgliedschaft", async () => {
    const email = fresh();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        members.invite({ tenantId: SHOP_A, invitedBy: owner, email, role: "staff", locale: "de" }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const { rows } = await inspect.query<{ n: string; m: string }>(
      `SELECT (SELECT count(*) FROM identity."user" WHERE email = $1) AS n,
              (SELECT count(*) FROM identity.membership m JOIN identity."user" u ON u.id = m.user_id WHERE u.email = $1) AS m`,
      [email],
    );
    expect(rows[0]).toEqual({ n: "1", m: "1" });
  });

  it("Mitarbeiter entfernen: Zugang und alle seine API-Token sofort weg, auch nach erneuter Einladung", async () => {
    const staff = await staffMember();
    const t = await tokens.create({
      tenantId: SHOP_A,
      userId: staff.userId,
      name: "Skript",
      scopes: ["products:read"],
    });
    if (!t.ok) throw new Error(t.reason);
    expect(await tokens.authenticate(t.token)).toBeDefined();
    const since = new Date();

    const removed = await members.remove(SHOP_A, staff.memberId);
    expect(removed).toMatchObject({ ok: true, revokedApiTokens: 1 });
    expect(await memberships.findMembership(staff.userId, SHOP_A)).toBeUndefined();
    expect(await tokens.authenticate(t.token)).toBeUndefined();
    const { rows } = await inspect.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.api_token WHERE id = $1`,
      [t.record.id],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(await outboxTypes(since)).toEqual(["identity.api_token.revoked.v1", "identity.member.removed.v1"]);

    // Das Konto bleibt bestehen; eine neue Einladung belebt das alte Token nicht wieder.
    const { code } = await invite(staff.email);
    expect((await members.accept({ code })).ok).toBe(true);
    expect(await memberships.findMembership(staff.userId, SHOP_A)).toEqual({
      tenantId: SHOP_A,
      role: "staff",
    });
    expect(await tokens.authenticate(t.token)).toBeUndefined();
    // Nochmal entfernen ergibt 404.
    const list = await members.list(SHOP_A, { limit: 100 });
    const current = list.find((m) => m.userId === staff.userId);
    expect((await members.remove(SHOP_A, current?.id ?? "")).ok).toBe(true);
    expect(await members.remove(SHOP_A, current?.id ?? "")).toEqual({ ok: false, reason: "not_found" });
  });

  it("Einladung zurückziehen: Code danach wertlos und gelöscht", async () => {
    const { code, result } = await invite(fresh());
    expect(await members.remove(SHOP_A, result.member.id)).toMatchObject({ ok: true, revokedApiTokens: 0 });
    expect(await members.accept({ code, password: NEW_PW })).toEqual({ ok: false, reason: "invalid_code" });
    const { rows } = await inspect.query(`SELECT 1 FROM identity.verification WHERE value_hash = $1`, [
      hashResetCode(code),
    ]);
    expect(rows).toEqual([]);
  });

  it("Code bleibt in der Tabelle, Mitgliedschaft aber weg: Annahme scheitert trotzdem", async () => {
    const { code, result } = await invite(fresh());
    await inspect.query(`DELETE FROM identity.membership WHERE id = $1`, [result.member.id]);
    expect(await members.accept({ code, password: NEW_PW })).toEqual({ ok: false, reason: "invalid_code" });
    // Der Code wurde dabei nicht verbraucht, und es wurde kein Passwort gesetzt.
    const { rows } = await inspect.query(`SELECT 1 FROM identity.account WHERE user_id = $1`, [
      result.member.userId,
    ]);
    expect(rows).toEqual([]);
  });

  it("die Inhaberin kann nicht entfernt werden; Mitglieder anderer Shops sind nicht auffindbar", async () => {
    const list = await members.list(SHOP_A, { limit: 100 });
    const ownerRow = list.find((m) => m.role === "owner");
    expect(ownerRow?.userId).toBe(owner);
    // Älteste zuerst: Die Inhaberin steht oben.
    expect(list[0]?.userId).toBe(owner);
    expect(await members.remove(SHOP_A, ownerRow?.id ?? "")).toEqual({ ok: false, reason: "owner" });
    const ownerOfB = (await members.list(SHOP_B, { limit: 100 })).find((m) => m.role === "owner");
    expect(await members.remove(SHOP_A, ownerOfB?.id ?? "")).toEqual({ ok: false, reason: "not_found" });
    expect(await members.remove(SHOP_A, "keine-uuid")).toEqual({ ok: false, reason: "not_found" });
    expect(list.some((m) => m.userId === ownerB && m.role === "owner")).toBe(false);
  });

  it("Liste seitenweise ohne Lücken und Doppelte", async () => {
    const all = await members.list(SHOP_A, { limit: 100 });
    const seen: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await members.list(SHOP_A, {
        limit: 2,
        ...(after === undefined ? {} : { afterId: after }),
      });
      seen.push(...page.slice(0, 2).map((m) => m.id));
      if (page.length <= 2) break;
      after = page[1]?.id;
    }
    expect(seen).toEqual(all.map((m) => m.id));
  });

  it("höchstens 20 offene Einladungen je Shop", async () => {
    const shop = uuidv7();
    await inspect.query(
      `WITH m AS (INSERT INTO platform.merchant (name) VALUES ('voll') RETURNING id)
       INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
       SELECT $1, m.id, p.id, 'voll', 'voll', 'active' FROM m, platform.plan p WHERE p.is_default`,
      [shop],
    );
    for (let i = 0; i < MAX_PENDING_INVITATIONS_PER_SHOP; i++) {
      const r = await members.invite({
        tenantId: shop,
        invitedBy: owner,
        email: fresh(),
        role: "staff",
        locale: "de",
      });
      expect(r.ok).toBe(true);
    }
    expect(
      await members.invite({ tenantId: shop, invitedBy: owner, email: fresh(), role: "staff", locale: "de" }),
    ).toEqual({ ok: false, reason: "too_many_pending" });
  });

  it("höchstens 3 E-Mails je Person und Shop in 15 Minuten; Versandfehler ohne Adresse im Protokoll", async () => {
    let t = Date.now();
    const limited = createMemberService({
      database,
      identity,
      baseUrl: "https://admin.localhost",
      mailer: { send: async (m) => void mails.push(m) },
      mailLimiter: new ResetMailLimiter(() => t, 3, 900),
      now: () => t,
    });
    const email = fresh();
    const sent: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await limited.invite({
        tenantId: SHOP_A,
        invitedBy: owner,
        email,
        role: "staff",
        locale: "de",
      });
      sent.push(r.ok && r.invitationSent);
    }
    expect(sent).toEqual([true, true, true, false]);
    t += 15 * 60_000 + 1000;
    const later = await limited.invite({
      tenantId: SHOP_A,
      invitedBy: owner,
      email,
      role: "staff",
      locale: "de",
    });
    expect(later.ok && later.invitationSent).toBe(true);

    failMail = true;
    const lines = logLines.length;
    const failed = await members.invite({
      tenantId: SHOP_A,
      invitedBy: owner,
      email: "ida@teeladen.example",
      role: "staff",
      locale: "de",
    });
    expect(failed.ok && failed.invitationSent).toBe(false);
    const written = logLines.slice(lines).join("\n");
    expect(written).toContain("E-Mail-Versand gescheitert");
    expect(written).toContain("EENVELOPE");
    expect(written).not.toContain("ida@");
  });

  it("Rechte: shop_app sieht keine Einladungscodes, shop_auth keine Mitgliedschaften", async () => {
    const app = new pg.Client({ connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app") });
    const auth = new pg.Client({ connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth") });
    await app.connect();
    await auth.connect();
    try {
      await expect(app.query(`SELECT * FROM identity.verification`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`INSERT INTO identity."user" (email) VALUES ('x@y.example')`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(auth.query(`SELECT * FROM identity.membership`)).rejects.toThrow(/permission denied/);
      // Prüfregel: Einladungscodes nur mit identifier <Shop>:<Konto>.
      await expect(
        auth.query(
          `INSERT INTO identity.verification (identifier, value_hash, purpose, expires_at)
           VALUES ('kaputt', $1, 'invitation', now() + interval '1 day')`,
          [randomBytes(32)],
        ),
      ).rejects.toThrow(/verification_invitation_identifier/);
    } finally {
      await app.end();
      await auth.end();
    }
  });
});
