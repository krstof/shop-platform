// E6 Teil 5 Ende zu Ende: Inhaberin legt ein API-Token an (nur mit frischer Passworteingabe),
// ein Skript ruft damit die Admin-API auf, die Inhaberin widerruft es. Echte Datenbank, echtes
// Anmeldemodul, Auflösung wie in main.ts (Sitzung oder Token).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApiTokenService,
  createIdentityService,
  createMembershipDirectory,
  type IdentityService,
} from "@shop/identity";
import { connectDatabase, createLogger, createSecretBox, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { createShopDirectory } from "@shop/platform";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiTokenResolver, requestResolver, sessionResolver, shopsOfUser } from "./actor.js";
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
const PW = "Kaffeebohnen-im-Februar-42";
const SHOP_A = uuidv7();
const SHOP_B = uuidv7();
const EMAILS = {
  owner: "inhaberin@teeladen.example",
  staff: "mitarbeiter@teeladen.example",
  ownerB: "inhaber@hemdenladen.example",
} as const;
type Who = keyof typeof EMAILS;

describe.skipIf(adminUrl === undefined)("API-Token über die API (E6 Teil 5, echte Datenbank)", () => {
  const dbName = `api_tokens_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let app: NestFastifyApplication;
  const users = {} as Record<Who, string>;
  const cookies = {} as Record<Who, string>;
  const sessions = {} as Record<Who, string>;
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

  async function signIn(who: Who) {
    const r = await inject({
      method: "POST",
      url: "/auth/v1/sign-in",
      remoteAddress: "203.0.113.30",
      headers: { "content-type": "application/json", origin: ADMIN },
      payload: JSON.stringify({ email: EMAILS[who], password: PW }),
    });
    expect(r.statusCode).toBe(200);
    cookies[who] = String([r.headers["set-cookie"]].flat()[0]).split(";")[0] ?? "";
    sessions[who] = r.json().session.id;
  }

  /** Anfrage mit Sitzung im eigenen Shop. */
  const asUser = (who: Who, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, shop = SHOP_A) =>
    inject({
      method,
      url,
      remoteAddress: "203.0.113.30",
      headers: {
        cookie: cookies[who],
        "shop-id": shop,
        ...(body === undefined ? {} : { "content-type": "application/json", origin: ADMIN }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  /** Anfrage eines Skripts mit Token (ohne Origin, ohne Cookie). */
  const asToken = (
    token: string,
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
    extra = {},
  ) =>
    inject({
      method,
      url,
      remoteAddress: "198.51.100.77",
      headers: {
        authorization: `Bearer ${token}`,
        ...extra,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  async function createToken(body: unknown = { name: "Lagerabgleich", scopes: ["products:read"] }) {
    const r = await asUser("owner", "POST", "/admin/v1/api-tokens", body);
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { id: string; token: string; prefix: string; scopes: string[] };
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
      applicationName: "api-token-test",
    });
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: ADMIN,
    });
    for (const [who, email] of Object.entries(EMAILS) as [Who, string][])
      users[who] = (await identity.createUser({ email, password: PW })).userId;
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
      `INSERT INTO identity.membership (tenant_id, user_id, role_key)
       VALUES ($1, $2, 'owner'), ($1, $3, 'staff'), ($4, $5, 'owner')`,
      [SHOP_A, users.owner, users.staff, SHOP_B, users.ownerB],
    );
    const memberships = createMembershipDirectory({ database });
    const shops = createShopDirectory({ database });
    const tokens = createApiTokenService({ database, memberships });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        identity,
        tokens,
        shopsOfUser: shopsOfUser({ memberships, shops }),
      }),
      resolveActor: requestResolver(
        sessionResolver({ identity, memberships, shops, operators: { findOperator: async () => undefined } }),
        apiTokenResolver({ tokens, shops }),
      ),
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
      rateLimiter: new RateLimiter(
        Object.fromEntries(
          Object.keys(DEFAULT_RATE_LIMITS).map((k) => [k, { limit: 1_000_000, windowMs: 60_000 }]),
        ) as typeof DEFAULT_RATE_LIMITS,
      ),
      allowedOrigins: [ADMIN],
    });
    for (const who of Object.keys(EMAILS) as Who[]) await signIn(who);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await identity?.close();
    await database?.destroy();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("Inhaberin legt ein Token an; es steht nur in dieser Antwort, die Liste zeigt nur den Anfang", async () => {
    const t = await createToken({ name: "Lagerabgleich", scopes: ["products:read", "orders:read"] });
    expect(t.token).toMatch(/^shp_at_[A-Za-z0-9_-]{43}$/);
    expect(t.prefix).toBe(t.token.slice(0, 11));
    expect(t.scopes).toEqual(["orders:read", "products:read"]);
    const list = await asUser("owner", "GET", "/admin/v1/api-tokens");
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(t.token.slice(11));
    expect(list.json().data[0]).toMatchObject({ id: t.id, status: "active", issuedForUserId: users.owner });
    expect(list.json().data[0]).not.toHaveProperty("token");
  });

  it("ein Skript arbeitet mit dem Token in der Admin-API, genau mit dessen Rechten", async () => {
    const t = await createToken({ name: "Hersteller-Abgleich", scopes: ["products:read"] });
    const get = await asToken(t.token, "GET", "/admin/v1/manufacturers");
    expect(get.statusCode, get.body).toBe(200);
    // Schreiben fehlt im Token, obwohl die Inhaberin es dürfte: 403.
    const post = await asToken(t.token, "POST", "/admin/v1/manufacturers", { name: "Teehaus" });
    expect(post.statusCode).toBe(403);
    // Token können keine Token sehen oder anlegen.
    expect((await asToken(t.token, "GET", "/admin/v1/api-tokens")).statusCode).toBe(403);
    expect(
      (await asToken(t.token, "POST", "/admin/v1/api-tokens", { name: "x", scopes: ["products:read"] }))
        .statusCode,
    ).toBe(403);
    // Platform-API und fremder Shop: 403.
    expect((await asToken(t.token, "GET", "/platform/v1/operator")).statusCode).toBe(403);
    expect(
      (await asToken(t.token, "GET", "/admin/v1/manufacturers", undefined, { "shop-id": SHOP_B })).statusCode,
    ).toBe(403);
  });

  it("was ein Token schreibt, steht mit dem Token als Urheber im Änderungsprotokoll", async () => {
    const t = await createToken({ name: "Import", scopes: ["products:write"] });
    const r = await asToken(t.token, "POST", "/admin/v1/manufacturers", { name: "Teehaus per Skript" });
    expect(r.statusCode, r.body).toBe(201);
    const { rows } = await inspect.query<{ actor: { type: string; id: string } }>(
      `SELECT actor FROM kernel.outbox WHERE type = 'catalog.manufacturer.created.v1' AND data->>'id' = $1`,
      [r.json().id],
    );
    expect(rows[0]?.actor).toEqual({ type: "api_token", id: t.id });
    const { rows: created } = await inspect.query<{ actor: { type: string; id: string } }>(
      `SELECT actor FROM kernel.outbox WHERE type = 'identity.api_token.created.v1' AND data->>'id' = $1`,
      [t.id],
    );
    expect(created[0]?.actor).toEqual({ type: "user", id: users.owner });
  });

  it("ungültige, kaputte und fremde Kopfzeilen ergeben 401, auch mit gültigem Cookie daneben", async () => {
    for (const authorization of [
      "Bearer shp_at_falsch",
      `Bearer shp_at_${"a".repeat(43)}`,
      "Basic dGVhbQ==",
      "Bearer",
    ]) {
      const r = await inject({
        method: "GET",
        url: "/admin/v1/manufacturers",
        headers: { authorization, cookie: cookies.owner, "shop-id": SHOP_A },
      });
      expect(r.statusCode, authorization).toBe(401);
    }
  });

  it("Mitarbeiter dürfen keine Token sehen oder anlegen", async () => {
    expect((await asUser("staff", "GET", "/admin/v1/api-tokens")).statusCode).toBe(403);
    expect(
      (await asUser("staff", "POST", "/admin/v1/api-tokens", { name: "x", scopes: ["products:read"] }))
        .statusCode,
    ).toBe(403);
  });

  it("Anlegen verlangt eine Passworteingabe vor höchstens 15 Minuten", async () => {
    await inspect.query(
      `UPDATE identity.session SET created_at = now() - interval '16 minutes' WHERE id = $1`,
      [sessions.owner],
    );
    const blocked = await asUser("owner", "POST", "/admin/v1/api-tokens", {
      name: "x",
      scopes: ["products:read"],
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("reauthentication_required");
    // Lesen und Widerrufen gehen weiter ohne Bestätigung.
    expect((await asUser("owner", "GET", "/admin/v1/api-tokens")).statusCode).toBe(200);

    const confirm = (password: string) =>
      inject({
        method: "POST",
        url: "/auth/v1/confirm-password",
        remoteAddress: "203.0.113.30",
        headers: { cookie: cookies.owner, "content-type": "application/json", origin: ADMIN },
        payload: JSON.stringify({ password }),
      });
    const wrong = await confirm("falsch-falsch-falsch");
    expect(wrong.statusCode).toBe(401);
    expect(
      (await asUser("owner", "POST", "/admin/v1/api-tokens", { name: "x", scopes: ["products:read"] }))
        .statusCode,
    ).toBe(403);
    const ok = await confirm(PW);
    expect(ok.statusCode).toBe(200);
    expect(Date.now() - Date.parse(ok.json().session.passwordConfirmedAt)).toBeLessThan(60_000);
    await createToken();
    // Von fremder Seite lässt sich das Passwort nicht bestätigen (CSRF).
    const foreign = await inject({
      method: "POST",
      url: "/auth/v1/confirm-password",
      headers: { cookie: cookies.owner, "content-type": "application/json", origin: "https://boese.example" },
      payload: JSON.stringify({ password: PW }),
    });
    expect(foreign.statusCode).toBe(403);
  });

  it("Eingaben: unbekannte Berechtigung, Token-Verwaltung, Ablauf in der Vergangenheit und fremde Felder ergeben 422", async () => {
    const bad = async (body: unknown) =>
      (await asUser("owner", "POST", "/admin/v1/api-tokens", body)).statusCode;
    expect(await bad({ name: "x", scopes: ["api_tokens:write"] })).toBe(422);
    expect(await bad({ name: "x", scopes: ["platform:read"] })).toBe(422);
    expect(await bad({ name: "x", scopes: [] })).toBe(422);
    expect(await bad({ name: "x", scopes: ["products:read", "products:read"] })).toBe(422);
    expect(await bad({ name: "x", scopes: ["products:read"], expiresAt: "2020-01-01T00:00:00Z" })).toBe(422);
    expect(await bad({ name: "x", scopes: ["products:read"], tenantId: SHOP_B })).toBe(422);
    expect(await bad({ name: "x", scopes: ["products:read"], issuedForUserId: users.staff })).toBe(422);
  });

  it("Widerruf: das Token gilt sofort nicht mehr; fremde Token lassen sich nicht widerrufen", async () => {
    const t = await createToken();
    expect((await asToken(t.token, "GET", "/admin/v1/manufacturers")).statusCode).toBe(200);
    const r = await asUser("owner", "DELETE", `/admin/v1/api-tokens/${t.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("revoked");
    expect((await asToken(t.token, "GET", "/admin/v1/manufacturers")).statusCode).toBe(401);
    // Token aus Shop B: aus Shop A heraus 404, es bleibt gültig.
    const b = await inject({
      method: "POST",
      url: "/admin/v1/api-tokens",
      headers: {
        cookie: cookies.ownerB,
        "shop-id": SHOP_B,
        "content-type": "application/json",
        origin: ADMIN,
      },
      payload: JSON.stringify({ name: "Hemden", scopes: ["products:read"] }),
    });
    expect(b.statusCode).toBe(201);
    expect((await asUser("owner", "DELETE", `/admin/v1/api-tokens/${b.json().id}`)).statusCode).toBe(404);
    expect((await asToken(b.json().token, "GET", "/admin/v1/manufacturers")).statusCode).toBe(200);
  });

  it("Uhr verbinden: Code aus dem Backoffice gibt ein Token nur zum Lesen von Bestellungen, genau einmal", async () => {
    const claim = (code: string, ip = "198.51.100.88") =>
      inject({
        method: "POST",
        url: "/auth/v1/device-pairings/claim",
        remoteAddress: ip,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ code }),
      });
    // Mitarbeiterin darf Bestellungen lesen, also auch eine Uhr verbinden.
    const made = await asUser("staff", "POST", "/admin/v1/device-pairings", {});
    expect(made.statusCode, made.body).toBe(201);
    const { code } = made.json() as { code: string };
    expect(code).toMatch(/^\d{8}$/);
    const ok = await claim(`${code.slice(0, 4)} ${code.slice(4)}`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ shopId: SHOP_A, shopName: "teeladen" });
    const token = ok.json().token as string;
    expect(
      (await asToken(token, "GET", "/admin/v1/orders", undefined, { "shop-id": SHOP_A })).statusCode,
    ).toBe(200);
    expect(
      (await asToken(token, "GET", "/admin/v1/products", undefined, { "shop-id": SHOP_A })).statusCode,
    ).toBe(403);
    // Nur einmal; ein neuer Code widerruft das alte Uhr-Token.
    expect((await claim(code)).statusCode).toBe(404);
    const again = (await asUser("staff", "POST", "/admin/v1/device-pairings", {})).json().code as string;
    expect((await claim(again)).statusCode).toBe(200);
    expect(
      (await asToken(token, "GET", "/admin/v1/orders", undefined, { "shop-id": SHOP_A })).statusCode,
    ).toBe(401);
    // Mit einem Token lässt sich keine Uhr verbinden; falsche Codes werden gebremst.
    expect(
      (await asToken(token, "POST", "/admin/v1/device-pairings", {}, { "shop-id": SHOP_A })).statusCode,
    ).toBe(401);
    for (let i = 0; i < 10; i++) expect((await claim("00000000", "198.51.100.99")).statusCode).toBe(404);
    expect((await claim("00000000", "198.51.100.99")).statusCode).toBe(429);
    expect((await claim("1234")).statusCode).toBe(422);
  });

  it("Inhaberin verliert die Mitgliedschaft oder der Shop wird gesperrt: Token gilt nicht mehr", async () => {
    const t = await createToken();
    await inspect.query(`UPDATE platform.tenant SET status = 'suspended' WHERE id = $1`, [SHOP_A]);
    expect((await asToken(t.token, "GET", "/admin/v1/manufacturers")).statusCode).toBe(401);
    await inspect.query(`UPDATE platform.tenant SET status = 'active' WHERE id = $1`, [SHOP_A]);
    expect((await asToken(t.token, "GET", "/admin/v1/manufacturers")).statusCode).toBe(200);
    await inspect.query(`UPDATE identity.membership SET status = 'disabled' WHERE user_id = $1`, [
      users.owner,
    ]);
    expect((await asToken(t.token, "GET", "/admin/v1/manufacturers")).statusCode).toBe(401);
    await inspect.query(`UPDATE identity.membership SET status = 'active' WHERE user_id = $1`, [users.owner]);
  });
});
