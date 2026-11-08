// API-Token gegen eine echte Datenbank (E6 Teil 5, Sicherheit 5.2 und 5.3): nur der Hash
// gespeichert, Schnittmenge mit der Rolle, Widerruf, Ablauf, RLS vor der Shop-Auswahl,
// Spaltenrechte und erneute Passworteingabe. Läuft wie im Betrieb als shop_app bzw. shop_auth.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scope } from "@shop/http";
import { connectDatabase, createSecretBox, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApiTokenService,
  createIdentityService,
  LoginThrottle,
  MAX_ACTIVE_TOKENS_PER_SHOP,
  type ApiTokenService,
  type IdentityService,
} from "./index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const PW = "Kaffeebohnen-im-Februar-42";
const SHOP_A = uuidv7();
const SHOP_B = uuidv7();
const MINUTE = 60_000;

describe.skipIf(adminUrl === undefined)("API-Token (echte Datenbank)", () => {
  const dbName = `identity_tok_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let appClient: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let tokens: ApiTokenService;
  let offset = 0;
  const now = () => Date.now() + offset;
  let owner: string;
  let ownerB: string;
  let staff: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    inspect = new pg.Client({ connectionString: setupUrl.href });
    await inspect.connect();
    appClient = new pg.Client({ connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app") });
    await appClient.connect();
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 3,
      applicationName: "identity-token-test",
    });
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: "https://admin.localhost",
      loginThrottle: new LoginThrottle(undefined, now),
      now,
    });
    tokens = createApiTokenService({ database, now });
    owner = (await identity.createUser({ email: "inhaberin@teeladen.example", password: PW })).userId;
    ownerB = (await identity.createUser({ email: "inhaber@hemdenladen.example", password: PW })).userId;
    staff = (await identity.createUser({ email: "mitarbeiter@teeladen.example", password: PW })).userId;
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
      `INSERT INTO identity.membership (tenant_id, user_id, role_key) VALUES ($1, $2, 'owner'), ($3, $4, 'owner'), ($1, $5, 'staff')`,
      [SHOP_A, owner, SHOP_B, ownerB, staff],
    );
  }, 60_000);

  afterAll(async () => {
    await identity?.close();
    await database?.destroy();
    await appClient?.end();
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  async function newToken(scopes: readonly Scope[] = ["products:read"], tenantId = SHOP_A, userId = owner) {
    const r = await tokens.create({ tenantId, userId, name: "Lagerabgleich", scopes });
    if (!r.ok) throw new Error(`Anlegen fehlgeschlagen: ${r.reason}`);
    return r;
  }

  it("speichert nur Hash und Präfix; das Token gilt für genau seinen Shop", async () => {
    const r = await newToken(["products:read", "orders:read"]);
    const { rows } = await inspect.query<{ token_hash: Buffer; token_prefix: string; scopes: string[] }>(
      `SELECT token_hash, token_prefix, scopes FROM identity.api_token WHERE id = $1`,
      [r.record.id],
    );
    expect(rows[0]?.token_hash).toEqual(createHash("sha256").update(r.token).digest());
    expect(rows[0]?.token_prefix).toBe(r.token.slice(0, 11));
    expect(rows[0]?.scopes).toEqual(["orders:read", "products:read"]);
    // Das Token steht nirgends in der Datenbank, auch nicht in der Outbox.
    const { rows: hits } = await inspect.query(
      `SELECT 1 FROM identity.api_token t, kernel.outbox o
        WHERE t.id = $1 AND (o.data::text LIKE '%' || $2 || '%' OR t.name LIKE '%' || $2 || '%')`,
      [r.record.id, r.token.slice(11)],
    );
    expect(hits).toEqual([]);
    const a = await tokens.authenticate(r.token);
    expect(a).toEqual({
      tokenId: r.record.id,
      tenantId: SHOP_A,
      scopes: new Set(["orders:read", "products:read"]),
    });
  });

  it("Anlegen schreibt das Ereignis identity.api_token.created.v1 ohne Token", async () => {
    const r = await newToken();
    const { rows } = await inspect.query<{
      data: Record<string, unknown>;
      tenant_id: string;
      actor: unknown;
    }>(
      `SELECT data, tenant_id, actor FROM kernel.outbox WHERE type = 'identity.api_token.created.v1' AND data->>'id' = $1`,
      [r.record.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(SHOP_A);
    expect(Object.keys(rows[0]?.data ?? {}).sort()).toEqual(["expiresAt", "id", "name", "prefix", "scopes"]);
  });

  it("falsche, fast richtige und fremd geformte Token gelten nicht", async () => {
    const r = await newToken();
    const last = r.token.at(-1) === "A" ? "B" : "A";
    for (const bad of [
      r.token.slice(0, -1) + last,
      r.token.toUpperCase(),
      `${r.token}x`,
      r.record.prefix,
      "",
    ])
      expect(await tokens.authenticate(bad), bad).toBeUndefined();
  });

  it("RLS: Mit dem Hash sieht shop_app genau dieses eine Token, ohne Hash keins", async () => {
    const r = await newToken();
    await newToken(["products:read"], SHOP_B, ownerB);
    const hash = createHash("sha256").update(r.token).digest("hex");
    await appClient.query("BEGIN");
    try {
      await appClient.query(`SELECT set_config('app.api_token_hash', $1, true)`, [hash]);
      const { rows } = await appClient.query<{ id: string }>(`SELECT id FROM identity.api_token`);
      expect(rows.map((x) => x.id)).toEqual([r.record.id]);
      // Andere Mandantentabellen bleiben leer.
      const { rows: m } = await appClient.query(`SELECT 1 FROM identity.membership`);
      expect(m).toEqual([]);
      await appClient.query(`SELECT set_config('app.api_token_hash', '', true)`);
      const { rows: none } = await appClient.query(`SELECT id FROM identity.api_token`);
      expect(none).toEqual([]);
    } finally {
      await appClient.query("ROLLBACK");
    }
  });

  it("Schnittmenge mit der Rolle: Mitgliedschaft weg oder Konto gesperrt, dann gilt das Token sofort nicht mehr", async () => {
    const r = await newToken(["products:read", "audit:read"], SHOP_A, staff);
    expect((await tokens.authenticate(r.token))?.scopes).toEqual(new Set(["audit:read", "products:read"]));
    await inspect.query(`UPDATE identity.membership SET status = 'disabled' WHERE user_id = $1`, [staff]);
    expect(await tokens.authenticate(r.token)).toBeUndefined();
    await inspect.query(`UPDATE identity.membership SET status = 'active' WHERE user_id = $1`, [staff]);
    expect(await tokens.authenticate(r.token)).toBeDefined();
    await inspect.query(`UPDATE identity."user" SET status = 'disabled' WHERE id = $1`, [staff]);
    expect(await tokens.authenticate(r.token)).toBeUndefined();
    await inspect.query(`UPDATE identity."user" SET status = 'active' WHERE id = $1`, [staff]);
  });

  it("Ein in der Datenbank erweitertes Token bekommt weder Platform- noch Token-Rechte", async () => {
    // Die Inhaberin hat api_tokens:* (Rolle), aber kein Token darf es tragen; platform:* hat ihre Rolle nicht.
    const r = await newToken(["products:read"], SHOP_A, owner);
    await inspect.query(
      `UPDATE identity.api_token SET scopes = '{products:read,api_tokens:write,platform:write,erfunden:read}' WHERE id = $1`,
      [r.record.id],
    );
    expect((await tokens.authenticate(r.token))?.scopes).toEqual(new Set(["products:read"]));
  });

  it("Anlegen nur mit eigenen Rechten und nie mit api_tokens:* oder platform:*", async () => {
    for (const scope of ["api_tokens:read", "api_tokens:write", "platform:read"] as const satisfies Scope[]) {
      const r = await tokens.create({ tenantId: SHOP_A, userId: owner, name: "x", scopes: [scope] });
      expect(r).toEqual({ ok: false, reason: "scope_not_allowed", scopes: [scope] });
    }
    // Fremder Shop: Das Konto hat dort keine Rolle, also keine Rechte.
    const foreign = await tokens.create({
      tenantId: SHOP_B,
      userId: owner,
      name: "x",
      scopes: ["products:read"],
    });
    expect(foreign.ok).toBe(false);
  });

  it("Widerruf gilt sofort, ist endgültig und schreibt genau ein Ereignis", async () => {
    const r = await newToken();
    const revoked = await tokens.revoke(SHOP_A, r.record.id);
    expect(revoked?.status).toBe("revoked");
    expect(await tokens.authenticate(r.token)).toBeUndefined();
    expect((await tokens.revoke(SHOP_A, r.record.id))?.revokedAt).toEqual(revoked?.revokedAt);
    const { rows } = await inspect.query(
      `SELECT 1 FROM kernel.outbox WHERE type = 'identity.api_token.revoked.v1' AND data->>'id' = $1`,
      [r.record.id],
    );
    expect(rows).toHaveLength(1);
    // Aus einem anderen Shop lässt es sich nicht finden.
    const other = await newToken(["products:read"], SHOP_B, ownerB);
    expect(await tokens.revoke(SHOP_A, other.record.id)).toBeUndefined();
    expect(await tokens.authenticate(other.token)).toBeDefined();
  });

  it("Ablaufdatum: davor gültig, danach nicht; Vergangenheit lässt sich nicht anlegen", async () => {
    const past = await tokens.create({
      tenantId: SHOP_A,
      userId: owner,
      name: "alt",
      scopes: ["products:read"],
      expiresAt: new Date(now() - MINUTE),
    });
    expect(past).toEqual({ ok: false, reason: "expiry_in_past" });
    const r = await tokens.create({
      tenantId: SHOP_A,
      userId: owner,
      name: "kurz",
      scopes: ["products:read"],
      expiresAt: new Date(now() + 10 * MINUTE),
    });
    if (!r.ok) throw new Error(r.reason);
    expect(await tokens.authenticate(r.token)).toBeDefined();
    offset = 11 * MINUTE;
    try {
      expect(await tokens.authenticate(r.token)).toBeUndefined();
      const listed = await tokens.list(SHOP_A, { limit: 100 });
      expect(listed.find((t) => t.id === r.record.id)?.status).toBe("expired");
    } finally {
      offset = 0;
    }
  });

  it("„zuletzt benutzt“ wird höchstens einmal je Minute geschrieben", async () => {
    const r = await newToken();
    const lastUsed = async () =>
      (
        await inspect.query<{ v: Date | null }>(
          `SELECT last_used_at v FROM identity.api_token WHERE id = $1`,
          [r.record.id],
        )
      ).rows[0]?.v;
    expect(await lastUsed()).toBeNull();
    await tokens.authenticate(r.token);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await tokens.authenticate(r.token);
    expect(await lastUsed()).toEqual(first);
    offset = 2 * MINUTE;
    try {
      await tokens.authenticate(r.token);
      expect((await lastUsed())?.getTime()).toBeGreaterThan(first?.getTime() ?? 0);
    } finally {
      offset = 0;
    }
  });

  it("shop_app darf ein Token nachträglich weder erweitern noch löschen (Spaltenrechte)", async () => {
    const r = await newToken();
    await appClient.query("BEGIN");
    try {
      await appClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [SHOP_A]);
      for (const stmt of [
        `UPDATE identity.api_token SET scopes = '{products:write}' WHERE id = $1`,
        `UPDATE identity.api_token SET expires_at = NULL WHERE id = $1`,
        `UPDATE identity.api_token SET issued_for_user_id = NULL WHERE id = $1`,
        `UPDATE identity.api_token SET token_hash = '\\x00' WHERE id = $1`,
        `DELETE FROM identity.api_token WHERE id = $1`,
      ]) {
        await appClient.query("SAVEPOINT s");
        await expect(appClient.query(stmt, [r.record.id]), stmt).rejects.toThrow(/permission denied/);
        await appClient.query("ROLLBACK TO SAVEPOINT s");
      }
      await appClient.query(`UPDATE identity.api_token SET revoked_at = now() WHERE id = $1`, [r.record.id]);
    } finally {
      await appClient.query("ROLLBACK");
    }
  });

  it("Liste: neueste zuerst, nur der eigene Shop, ohne Hash", async () => {
    const list = await tokens.list(SHOP_A, { limit: 100 });
    expect(list.length).toBeGreaterThan(3);
    const ids = list.map((t) => t.id);
    expect(ids).toEqual([...ids].sort().reverse());
    const { rows } = await inspect.query<{ id: string }>(
      `SELECT id FROM identity.api_token WHERE tenant_id = $1`,
      [SHOP_B],
    );
    for (const { id } of rows) expect(ids).not.toContain(id);
    expect(JSON.stringify(list)).not.toMatch(/hash/i);
  });

  it(`höchstens ${MAX_ACTIVE_TOKENS_PER_SHOP} gültige Token je Shop; widerrufene zählen nicht`, async () => {
    const { rows } = await inspect.query<{ n: string }>(
      `SELECT count(*) n FROM identity.api_token WHERE tenant_id = $1 AND revoked_at IS NULL`,
      [SHOP_B],
    );
    let active = Number(rows[0]?.n);
    let last = "";
    while (active < MAX_ACTIVE_TOKENS_PER_SHOP) {
      last = (await newToken(["products:read"], SHOP_B, ownerB)).record.id;
      active++;
    }
    const full = await tokens.create({
      tenantId: SHOP_B,
      userId: ownerB,
      name: "zu viel",
      scopes: ["products:read"],
    });
    expect(full).toEqual({ ok: false, reason: "too_many_tokens" });
    await tokens.revoke(SHOP_B, last);
    expect(
      (await tokens.create({ tenantId: SHOP_B, userId: ownerB, name: "wieder", scopes: ["products:read"] }))
        .ok,
    ).toBe(true);
  });

  describe("Passwort erneut bestätigen", () => {
    async function signIn() {
      const r = await identity.signIn({
        email: "inhaberin@teeladen.example",
        password: PW,
        ipAddress: "203.0.113.9",
      });
      if (!r.ok) throw new Error(r.reason);
      return { ...r, cookie: r.setCookie.split(";")[0] ?? "" };
    }

    it("die Anmeldung zählt als Passworteingabe; Bestätigung setzt die Zeit neu", async () => {
      const s = await signIn();
      const before = await identity.getSession(s.cookie);
      expect(before?.passwordConfirmedAt).toEqual(before?.createdAt);
      await inspect.query(
        `UPDATE identity.session SET created_at = created_at - interval '20 minutes' WHERE id = $1`,
        [s.sessionId],
      );
      const old = await identity.getSession(s.cookie);
      expect(Date.now() - (old?.passwordConfirmedAt.getTime() ?? 0)).toBeGreaterThan(19 * MINUTE);
      const ok = await identity.confirmPassword({ cookie: s.cookie, password: PW, ipAddress: "203.0.113.9" });
      expect(ok.ok).toBe(true);
      const after = await identity.getSession(s.cookie);
      expect(Date.now() - (after?.passwordConfirmedAt.getTime() ?? 0)).toBeLessThan(MINUTE);
    });

    it("falsches Passwort zählt als Fehlversuch und wird gebremst; ohne Sitzung no_session", async () => {
      const s = await signIn();
      expect(await identity.confirmPassword({ cookie: undefined, password: PW })).toEqual({
        ok: false,
        reason: "no_session",
      });
      const results = [];
      for (let i = 0; i < 6; i++)
        results.push(
          await identity.confirmPassword({
            cookie: s.cookie,
            password: "falsch-falsch-falsch",
            ipAddress: "198.51.100.4",
          }),
        );
      expect(results.slice(0, 5).every((r) => !r.ok && r.reason === "invalid_password")).toBe(true);
      expect(results[5]).toMatchObject({ ok: false, reason: "throttled" });
      // Auch das richtige Passwort wartet jetzt, bis die Bremse frei ist.
      expect(
        await identity.confirmPassword({ cookie: s.cookie, password: PW, ipAddress: "198.51.100.4" }),
      ).toMatchObject({
        ok: false,
        reason: "throttled",
      });
    });
  });
});
