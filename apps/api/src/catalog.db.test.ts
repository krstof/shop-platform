// Beispiel-Endpunkte gegen eine echte Datenbank (Architektur 5.7): Shop A sieht nur seine
// Hersteller, IDs aus Shop B ergeben 404 (T-08 für diese Endpunkte, der Generator für alle
// Endpunkte folgt mit E4 Teil 2), Seiten mit Cursor ohne Lücken und Doppelte.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints } from "./endpoints.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const COUNT_A = 7;
const USER_A = uuidv7();
const USER_B = uuidv7();

/** Anmeldung im Test: Kopfzeile x-test-shop wählt den Shop, mit products:read/write und audit:read. */
const resolver: ActorResolver = async ({ headers }) => {
  const shop = headers["x-test-shop"];
  if (shop !== "a" && shop !== "b") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: shop === "a" ? USER_A : USER_B },
    tenantId: shop === "a" ? TENANT_A : TENANT_B,
    scopes: new Set(["products:read", "products:write", "audit:read"]),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Hersteller-Endpunkte (echte Datenbank)", () => {
  const dbName = `api_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let database: Database<unknown>;
  let appUrl: string;
  let app: NestFastifyApplication;
  /** Superuser auf der Testdatenbank, nur zum Nachsehen in Outbox und Protokoll. */
  let inspect: pg.Client;
  const idsB: string[] = [];
  const archivedId = uuidv7();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    // Ohne Rollen-Passwörter: Andere Pakete testen gleichzeitig auf demselben Server (siehe roleUrl).
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });

    const setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    for (const [id, handle] of [
      [TENANT_A, "teeladen-a"],
      [TENANT_B, "modeladen-b"],
    ] as const) {
      await setup.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    // Hersteller in Anlagereihenfolge (UUIDv7), einer davon archiviert.
    for (let i = 1; i <= COUNT_A; i++) {
      await setup.query(`INSERT INTO catalog.manufacturer (tenant_id, id, name) VALUES ($1, $2, $3)`, [
        TENANT_A,
        uuidv7(),
        `Teehaus ${i}`,
      ]);
    }
    await setup.query(
      `INSERT INTO catalog.manufacturer (tenant_id, id, name, archived_at, country_code, eu_responsible_name)
       VALUES ($1, $2, 'Alter Hersteller', now(), 'CN', 'EU-Vertretung GmbH')`,
      [TENANT_A, archivedId],
    );
    for (const name of ["Hemdenwerk", "Hosenbau"]) {
      const id = uuidv7();
      idsB.push(id);
      await setup.query(`INSERT INTO catalog.manufacturer (tenant_id, id, name) VALUES ($1, $2, $3)`, [
        TENANT_B,
        id,
        name,
      ]);
    }
    await setup.end();
    inspect = new pg.Client({ connectionString: setupUrl.href });
    await inspect.connect();

    appUrl = roleUrl(adminUrl ?? "", dbName, "shop_app");
    database = connectDatabase<unknown>({
      connectionString: appUrl,
      maxConnections: 3,
      applicationName: "api-test",
    });
    app = await createApi({
      endpoints: allEndpoints({ database }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.destroy();
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  const get = (url: string, shop: "a" | "b") =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url, headers: { "x-test-shop": shop } });

  it("die API arbeitet als shop_app ohne Superuser-Rechte, RLS greift", async () => {
    const c = new pg.Client({ connectionString: appUrl });
    await c.connect();
    try {
      const { rows } = await c.query(
        `SELECT current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
                (SELECT count(*)::int FROM catalog.manufacturer) AS visible`,
      );
      expect(rows).toEqual([{ who: "shop_app", su: false, visible: 0 }]);
    } finally {
      await c.end();
    }
  });

  it("jeder Shop sieht nur seine eigenen Hersteller", async () => {
    const a = await get("/admin/v1/manufacturers", "a");
    expect(a.statusCode).toBe(200);
    expect(a.json().data).toHaveLength(COUNT_A);
    expect(a.json().data.every((m: { name: string }) => m.name.startsWith("Teehaus"))).toBe(true);
    const b = await get("/admin/v1/manufacturers", "b");
    expect(b.json().data.map((m: { name: string }) => m.name)).toEqual(["Hemdenwerk", "Hosenbau"]);
  });

  it("T-08: ID aus Shop B ergibt in Shop A 404, genau wie eine erfundene ID", async () => {
    const own = await get(`/admin/v1/manufacturers/${idsB[0]}`, "b");
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ id: idsB[0], name: "Hemdenwerk", version: 1, archivedAt: null });
    const foreign = await get(`/admin/v1/manufacturers/${idsB[0]}`, "a");
    const invented = await get(`/admin/v1/manufacturers/${uuidv7()}`, "a");
    expect(foreign.statusCode).toBe(404);
    expect(invented.statusCode).toBe(404);
    // Die Antworten unterscheiden sich nur in der requestId: keine Spur, dass die ID existiert.
    const strip = (r: typeof foreign) => ({ ...r.json(), requestId: undefined });
    expect(strip(foreign)).toEqual(strip(invented));
    expect(foreign.body).not.toContain("Hemdenwerk");
  });

  it("Cursor: alle Seiten zusammen ergeben jede Zeile genau einmal, in Anlagereihenfolge", async () => {
    const seen: string[] = [];
    let url = "/admin/v1/manufacturers?limit=3";
    for (let page = 0; page < 10; page++) {
      const r = await get(url, "a");
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.data.length).toBeLessThanOrEqual(3);
      seen.push(...body.data.map((m: { name: string }) => m.name));
      if (!body.page.hasMore) {
        expect(body.page.nextCursor).toBeNull();
        break;
      }
      url = `/admin/v1/manufacturers?limit=3&cursor=${body.page.nextCursor}`;
    }
    expect(seen).toEqual(Array.from({ length: COUNT_A }, (_, i) => `Teehaus ${i + 1}`));
  });

  it("archivierte Hersteller fehlen in der Liste, sind aber einzeln lesbar, mit GPSR-Angaben", async () => {
    const list = await get("/admin/v1/manufacturers?limit=100", "a");
    expect(list.json().data.some((m: { name: string }) => m.name === "Alter Hersteller")).toBe(false);
    const one = await get(`/admin/v1/manufacturers/${archivedId}`, "a");
    expect(one.statusCode).toBe(200);
    expect(one.json().archivedAt).toMatch(/Z$/);
    expect(one.json().address.countryCode).toBe("CN");
    expect(one.json().euResponsiblePerson).toEqual({
      name: "EU-Vertretung GmbH",
      address: null,
      email: null,
      phone: null,
    });
  });

  it("kaputter oder fremder Cursor ergibt 422, kein 500", async () => {
    for (const cursor of ["abc", Buffer.from('{"id":"x\' OR 1=1"}').toString("base64url")]) {
      const r = await get(`/admin/v1/manufacturers?cursor=${cursor}`, "a");
      expect(r.statusCode).toBe(422);
      expect(r.json().errors[0].path).toBe("/query/cursor");
    }
  });

  it("ungültige ID ergibt 422 ohne Datenbankfehler", async () => {
    const r = await get("/admin/v1/manufacturers/1;DROP TABLE x", "a");
    expect(r.statusCode).toBe(422);
  });

  const send = (
    method: "POST" | "PATCH",
    url: string,
    shop: "a" | "b",
    payload: object,
    headers: Record<string, string> = {},
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, headers: { "x-test-shop": shop, ...headers }, payload });

  it("Anlegen ergibt 201 mit ETag, der Hersteller landet im eigenen Shop", async () => {
    const r = await send("POST", "/admin/v1/manufacturers", "a", {
      name: "Neu A",
      address: { countryCode: "DE" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.headers["etag"]).toBe('"1"');
    expect(r.json()).toMatchObject({ name: "Neu A", version: 1, address: { countryCode: "DE" } });
    expect((await get(`/admin/v1/manufacturers/${r.json().id}`, "a")).statusCode).toBe(200);
    expect((await get(`/admin/v1/manufacturers/${r.json().id}`, "b")).statusCode).toBe(404);
  });

  it("Idempotenz: Wiederholung liefert dieselbe Antwort, andere Anfrage mit demselben Schlüssel 422", async () => {
    const key = `test-${uuidv7()}`;
    const first = await send(
      "POST",
      "/admin/v1/manufacturers",
      "a",
      { name: "Einmalig" },
      { "idempotency-key": key },
    );
    const again = await send(
      "POST",
      "/admin/v1/manufacturers",
      "a",
      { name: "Einmalig" },
      { "idempotency-key": key },
    );
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json().id).toBe(first.json().id);
    const other = await send(
      "POST",
      "/admin/v1/manufacturers",
      "a",
      { name: "Anders" },
      { "idempotency-key": key },
    );
    expect(other.statusCode).toBe(422);
    expect(other.json().code).toBe("idempotency_key_reused");
    // Derselbe Schlüssel in einem anderen Shop ist ein eigener Schlüssel.
    const shopB = await send(
      "POST",
      "/admin/v1/manufacturers",
      "b",
      { name: "Einmalig" },
      { "idempotency-key": key },
    );
    expect(shopB.statusCode).toBe(201);
    expect(shopB.headers["idempotent-replayed"]).toBeUndefined();
    const list = await get("/admin/v1/manufacturers?limit=100", "a");
    expect(list.json().data.filter((m: { name: string }) => m.name === "Einmalig")).toHaveLength(1);
  });

  it("Idempotenz: fünf gleichzeitige Wiederholungen legen genau einen Hersteller an", async () => {
    const key = `parallel-${uuidv7()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        send("POST", "/admin/v1/manufacturers", "a", { name: "Gleichzeitig" }, { "idempotency-key": key }),
      ),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    const list = await get("/admin/v1/manufacturers?limit=100", "a");
    expect(list.json().data.filter((m: { name: string }) => m.name === "Gleichzeitig")).toHaveLength(1);
  });

  it("Idempotency-Key mit falschem Format ergibt 400", async () => {
    const r = await send(
      "POST",
      "/admin/v1/manufacturers",
      "a",
      { name: "X" },
      { "idempotency-key": "kurz" },
    );
    expect(r.statusCode).toBe(400);
    expect(r.json().errors[0].path).toBe("/headers/idempotency-key");
  });

  it("Ändern: ohne If-Match 428, alte Version 412, passende Version 200 mit neuem ETag", async () => {
    const created = await send("POST", "/admin/v1/manufacturers", "a", { name: "Versioniert" });
    const url = `/admin/v1/manufacturers/${created.json().id}`;
    expect((await send("PATCH", url, "a", { city: "x" })).statusCode).toBe(422);
    const noMatch = await send("PATCH", url, "a", { email: "a@example.org" });
    expect(noMatch.statusCode).toBe(428);
    const ok = await send("PATCH", url, "a", { email: "a@example.org" }, { "if-match": '"1"' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["etag"]).toBe('"2"');
    expect(ok.json()).toMatchObject({ email: "a@example.org", name: "Versioniert", version: 2 });
    // Zweiter Bearbeiter mit veraltetem Stand überschreibt nicht unbemerkt.
    const stale = await send("PATCH", url, "a", { email: "b@example.org" }, { "if-match": '"1"' });
    expect(stale.statusCode).toBe(412);
    expect((await get(url, "a")).json().email).toBe("a@example.org");
    expect((await send("PATCH", url, "a", { email: null }, { "if-match": "2" })).statusCode).toBe(400);
    // Fund von Schemathesis: leeres address-Objekt ändert nichts, war vorher ein 500er.
    const empty = await send("PATCH", url, "a", { address: {} }, { "if-match": '"2"' });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers["etag"]).toBe('"2"');
  });

  it("T-08: Ändern eines Herstellers aus Shop B ergibt in Shop A 404, B bleibt unverändert", async () => {
    const r = await send(
      "PATCH",
      `/admin/v1/manufacturers/${idsB[1]}`,
      "a",
      { name: "Gekapert" },
      { "if-match": '"1"' },
    );
    expect(r.statusCode).toBe(404);
    expect((await get(`/admin/v1/manufacturers/${idsB[1]}`, "b")).json().name).toBe("Hosenbau");
  });

  // --- Ereignisse (Outbox, Etappe E5) ---

  const eventsFor = async (id: string) =>
    (
      await inspect.query(
        `SELECT tenant_id, type, actor, data, correlation_id FROM kernel.outbox WHERE data->>'id' = $1 ORDER BY id`,
        [id],
      )
    ).rows;

  it("Anlegen und Ändern schreiben je ein Ereignis mit Urheber, nur mit geänderten Feldern", async () => {
    const correlation = uuidv7();
    const created = await send(
      "POST",
      "/admin/v1/manufacturers",
      "a",
      { name: "Mit Ereignis", address: { city: "Kiel" } },
      { "x-correlation-id": correlation },
    );
    const id = created.json().id as string;
    const changed = await send(
      "PATCH",
      `/admin/v1/manufacturers/${id}`,
      "a",
      { address: { city: "Hamburg" }, email: "info@teehaus.example", name: "Mit Ereignis" },
      { "if-match": '"1"' },
    );
    expect(changed.statusCode).toBe(200);
    expect(await eventsFor(id)).toEqual([
      {
        tenant_id: TENANT_A,
        type: "catalog.manufacturer.created.v1",
        actor: { type: "user", id: USER_A },
        data: { id, name: "Mit Ereignis" },
        correlation_id: correlation,
      },
      {
        tenant_id: TENANT_A,
        type: "catalog.manufacturer.updated.v1",
        actor: { type: "user", id: USER_A },
        data: { id, changes: { city: ["Kiel", "Hamburg"], email: [null, "info@teehaus.example"] } },
        correlation_id: expect.any(String),
      },
    ]);
  });

  it("kein Ereignis ohne Änderung, bei 412, 404 und bei abgelehnter Eingabe", async () => {
    const created = await send("POST", "/admin/v1/manufacturers", "a", { name: "Ruhig" });
    const id = created.json().id as string;
    const url = `/admin/v1/manufacturers/${id}`;
    expect((await send("PATCH", url, "a", { name: "Ruhig" }, { "if-match": '"1"' })).statusCode).toBe(200);
    expect((await send("PATCH", url, "a", { name: "Neu" }, { "if-match": '"7"' })).statusCode).toBe(412);
    expect((await send("PATCH", url, "b", { name: "Fremd" }, { "if-match": '"1"' })).statusCode).toBe(404);
    expect((await send("PATCH", url, "a", { unbekannt: 1 }, { "if-match": '"1"' })).statusCode).toBe(422);
    expect((await eventsFor(id)).map((e: { type: string }) => e.type)).toEqual([
      "catalog.manufacturer.created.v1",
    ]);
  });

  // --- Änderungsprotokoll lesen (PLA-07) ---

  it("Änderungsprotokoll: neueste zuerst, Filter nach Objekt und Urheber, nur der eigene Shop", async () => {
    const thing = uuidv7();
    const insert = (tenant: string, entityId: string, action: string, actorType = "user") =>
      inspect.query(
        `INSERT INTO audit.audit_entry (tenant_id, actor_type, actor_id, action, entity_type, entity_id, changes)
         VALUES ($1, $2, $3, $4, 'catalog.manufacturer', $5, $6)`,
        [
          tenant,
          actorType,
          actorType === "user" ? USER_A : null,
          action,
          entityId,
          action.endsWith("updated.v1") ? JSON.stringify({ name: ["Alt", "Neu"] }) : null,
        ],
      );
    await insert(TENANT_A, thing, "catalog.manufacturer.created.v1");
    await insert(TENANT_A, thing, "catalog.manufacturer.updated.v1");
    await insert(TENANT_A, uuidv7(), "catalog.manufacturer.created.v1", "system");
    await insert(TENANT_B, thing, "catalog.manufacturer.archived.v1");

    const all = await get(`/admin/v1/audit-entries?entityId=${thing}`, "a");
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((e: { action: string }) => e.action)).toEqual([
      "catalog.manufacturer.updated.v1",
      "catalog.manufacturer.created.v1",
    ]);
    expect(all.json().data[0]).toMatchObject({
      actor: { type: "user", id: USER_A, onBehalfOfUserId: null },
      entity: { type: "catalog.manufacturer", id: thing },
      changes: { name: ["Alt", "Neu"] },
    });
    const fromB = await get(`/admin/v1/audit-entries?entityId=${thing}`, "b");
    expect(fromB.json().data.map((e: { action: string }) => e.action)).toEqual([
      "catalog.manufacturer.archived.v1",
    ]);

    const system = await get(`/admin/v1/audit-entries?actorType=system`, "a");
    expect(system.json().data).toHaveLength(1);
    const byType = await get(`/admin/v1/audit-entries?entityType=catalog.manufacturer&limit=1`, "a");
    expect(byType.json().data).toHaveLength(1);
    expect(byType.json().page.hasMore).toBe(true);
    const next = await get(
      `/admin/v1/audit-entries?entityType=catalog.manufacturer&limit=1&cursor=${byType.json().page.nextCursor}`,
      "a",
    );
    expect(next.json().data[0].id < byType.json().data[0].id).toBe(true);
    expect((await get(`/admin/v1/audit-entries?entityType=Katalog`, "a")).statusCode).toBe(422);
    expect((await get(`/admin/v1/audit-entries?actorType=operator`, "a")).statusCode).toBe(200);
  });
});
