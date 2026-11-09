// E6 Teil 7 Ende zu Ende: Die Inhaberin lädt eine Mitarbeiterin ein, diese nimmt über die Auth-API an,
// meldet sich an und arbeitet im Shop; die Inhaberin entfernt sie, und ab der nächsten Anfrage ist
// Schluss. Echte Datenbank, echtes Anmeldemodul, Auflösung wie in main.ts (Sitzung oder Token).
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApiTokenService,
  createIdentityService,
  createMemberService,
  createMembershipDirectory,
  type IdentityService,
  type OutgoingMail,
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
const STAFF_PW = "Teeblaetter-im-November-17";
const OWNER = "inhaberin@teeladen.example";
const STAFF = "ida@teeladen.example";
const SHOP_A = uuidv7();

interface SignInBody {
  readonly session: { readonly id: string };
  readonly shops: readonly { id: string; handle: string; name: string; role: string }[];
}

function codeIn(mail: OutgoingMail | undefined): string {
  const match = /#code=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "");
  if (match?.[1] === undefined) throw new Error("kein Link in der E-Mail");
  return match[1];
}

describe.skipIf(adminUrl === undefined)("Mitarbeiter über die API (E6 Teil 7, echte Datenbank)", () => {
  const dbName = `api_members_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let identity: IdentityService;
  let app: NestFastifyApplication;
  let ownerId: string;
  let ownerCookie: string;
  const mails: OutgoingMail[] = [];
  const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

  async function signIn(email: string, password: string): Promise<{ cookie: string; body: SignInBody }> {
    const r = await inject({
      method: "POST",
      url: "/auth/v1/sign-in",
      remoteAddress: "203.0.113.40",
      headers: { "content-type": "application/json", origin: ADMIN },
      payload: JSON.stringify({ email, password }),
    });
    expect(r.statusCode, r.body).toBe(200);
    return {
      cookie: String([r.headers["set-cookie"]].flat()[0]).split(";")[0] ?? "",
      body: r.json() as SignInBody,
    };
  }

  const asUser = (cookie: string, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) =>
    inject({
      method,
      url,
      remoteAddress: "203.0.113.40",
      headers: {
        cookie,
        "shop-id": SHOP_A,
        ...(body === undefined ? {} : { "content-type": "application/json", origin: ADMIN }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  const accept = (body: unknown, origin = ADMIN) =>
    inject({
      method: "POST",
      url: "/auth/v1/invitations/accept",
      remoteAddress: "198.51.100.40",
      headers: { "content-type": "application/json", origin },
      payload: JSON.stringify(body),
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
      maxConnections: 3,
      applicationName: "api-members-test",
    });
    identity = createIdentityService({
      secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_auth"),
      secret: randomBytes(32).toString("base64url"),
      baseUrl: ADMIN,
    });
    ownerId = (await identity.createUser({ email: OWNER, password: PW })).userId;
    await inspect.query(
      `WITH m AS (INSERT INTO platform.merchant (name) VALUES ('Teeladen') RETURNING id)
       INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
       SELECT $1, m.id, p.id, 'teeladen', 'Teeladen Morgentau', 'active' FROM m, platform.plan p WHERE p.is_default`,
      [SHOP_A],
    );
    await inspect.query(
      `INSERT INTO identity.membership (tenant_id, user_id, role_key) VALUES ($1, $2, 'owner')`,
      [SHOP_A, ownerId],
    );
    const memberships = createMembershipDirectory({ database });
    const shops = createShopDirectory({ database });
    const tokens = createApiTokenService({ database, memberships });
    const members = createMemberService({
      database,
      identity,
      baseUrl: ADMIN,
      mailer: { send: async (m) => void mails.push(m) },
      shopName: async (id) => (await shops.getShops([id]))[0]?.name,
    });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        identity,
        tokens,
        members,
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
    ownerCookie = (await signIn(OWNER, PW)).cookie;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await identity?.close();
    await database?.destroy();
    await inspect?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("einladen, annehmen, anmelden, mitarbeiten, entfernen: wirkt ab der nächsten Anfrage", async () => {
    const invited = await asUser(ownerCookie, "POST", "/admin/v1/members", { email: STAFF, role: "staff" });
    expect(invited.statusCode, invited.body).toBe(201);
    expect(invited.json()).toMatchObject({
      email: STAFF,
      role: "staff",
      status: "invited",
      invitationSent: true,
    });
    const memberId: string = invited.json().id;
    const mail = mails.at(-1);
    expect(mail?.to).toBe(STAFF);
    expect(mail?.subject).toBe("Einladung zum Shop „Teeladen Morgentau“");
    const code = codeIn(mail);

    // Neues Konto: ohne Passwort geht es nicht, und der Code bleibt gültig.
    const noPw = await accept({ code });
    expect(noPw.statusCode).toBe(422);
    expect(noPw.json().errors[0]).toMatchObject({ path: "/body/password", code: "password_required" });
    const ok = await accept({ code, password: STAFF_PW, name: "Ida" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ joined: true, shopId: SHOP_A, accountCreated: true });
    // Annehmen meldet nicht an.
    expect(ok.headers["set-cookie"]).toBeUndefined();
    const twice = await accept({ code, password: STAFF_PW });
    expect(twice.json().errors[0].code).toBe("invalid_invitation_code");

    const staff = await signIn(STAFF, STAFF_PW);
    expect(staff.body.shops).toEqual([
      { id: SHOP_A, handle: "teeladen", name: "Teeladen Morgentau", role: "staff" },
    ]);
    expect((await asUser(staff.cookie, "GET", "/admin/v1/manufacturers")).statusCode).toBe(200);
    // Mitarbeiter verwalten darf nur die Inhaberin.
    expect((await asUser(staff.cookie, "GET", "/admin/v1/members")).statusCode).toBe(403);
    expect((await asUser(staff.cookie, "DELETE", `/admin/v1/members/${memberId}`)).statusCode).toBe(403);

    const list = await asUser(ownerCookie, "GET", "/admin/v1/members");
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((m: { email: string; status: string }) => [m.email, m.status])).toEqual([
      [OWNER, "active"],
      [STAFF, "active"],
    ]);

    const removed = await asUser(ownerCookie, "DELETE", `/admin/v1/members/${memberId}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toEqual({ id: memberId, removed: true, revokedApiTokens: 0 });
    // Gleiche Sitzung, nächste Anfrage: kein Zugang mehr zum Shop.
    expect((await asUser(staff.cookie, "GET", "/admin/v1/manufacturers")).statusCode).toBe(403);
    const me = await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie: staff.cookie } });
    expect(me.json().shops).toEqual([]);
    expect((await asUser(ownerCookie, "DELETE", `/admin/v1/members/${memberId}`)).statusCode).toBe(404);
  });

  it("die Inhaberin kann sich nicht selbst entfernen; schon Mitglied ergibt 409", async () => {
    const list = await asUser(ownerCookie, "GET", "/admin/v1/members");
    const own = list.json().data.find((m: { userId: string }) => m.userId === ownerId);
    const r = await asUser(ownerCookie, "DELETE", `/admin/v1/members/${own.id}`);
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toContain("Inhaber");
    const self = await asUser(ownerCookie, "POST", "/admin/v1/members", { email: OWNER, role: "staff" });
    expect(self.statusCode).toBe(409);
  });

  it("eingeladen wird nur mit frischer Passworteingabe, nur mit Sitzung, nur als staff", async () => {
    // Passwort vor 20 Minuten eingegeben: 403 reauthentication_required.
    const stale = await signIn(OWNER, PW);
    await inspect.query(
      `UPDATE identity.session SET created_at = now() - interval '20 minutes', reauthenticated_at = NULL
        WHERE id = $1`,
      [stale.body.session.id],
    );
    const r = await asUser(stale.cookie, "POST", "/admin/v1/members", {
      email: "neu@teeladen.example",
      role: "staff",
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().type).toContain("reauthentication-required");

    const owner = await asUser(ownerCookie, "POST", "/admin/v1/members", {
      email: "zweite@teeladen.example",
      role: "owner",
    });
    expect(owner.statusCode).toBe(422);

    // Ein Token kann members:* gar nicht bekommen.
    const token = await asUser(ownerCookie, "POST", "/admin/v1/api-tokens", {
      name: "Versuch",
      scopes: ["members:write"],
    });
    expect(token.statusCode).toBe(422);
  });

  it("Annahme: fremde Herkunft 403, falscher Code 422, englische Meldung", async () => {
    const foreign = await accept({ code: "x".repeat(43), password: STAFF_PW }, "https://evil.example");
    expect(foreign.statusCode).toBe(403);
    const wrong = await inject({
      method: "POST",
      url: "/auth/v1/invitations/accept",
      remoteAddress: "198.51.100.40",
      headers: { "content-type": "application/json", origin: ADMIN, "accept-language": "en" },
      payload: JSON.stringify({ code: "x".repeat(43), password: STAFF_PW }),
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().errors[0]).toMatchObject({
      path: "/body/code",
      code: "invalid_invitation_code",
      message: "The invitation is invalid, already accepted, withdrawn or expired.",
    });
  });
});
