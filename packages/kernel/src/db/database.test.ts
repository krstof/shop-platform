// Integrationstest für withTenantTransaction mit echter PostgreSQL-Datenbank (Architektur 5.3).
// Braucht SHOP_TEST_DATABASE_URL (Superuser einer Wegwerf-Datenbank). In der CI ist sie
// gesetzt und SHOP_REQUIRE_DB_TESTS=true sorgt dafür, dass der Test nicht still übersprungen wird.
import { randomBytes } from "node:crypto";
import { sql, type Generated } from "kysely";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithContext } from "../context.js";
import { uuidv7 } from "../id.js";
import {
  connectDatabase,
  MissingTenantError,
  readSessionSettingForTest,
  withPlatformTransaction,
  withTenantTransaction,
  withApiTokenTransaction,
  withUserTransaction,
  type Database,
} from "./database.js";
import { runMigrations } from "./migrate.js";

// Eine echte Mandantentabelle aus dem Katalog (Migration des Moduls catalog): RLS mit FORCE,
// Regel über app.tenant_id, created_by aus app.actor_id. Nur die Spalten, die der Test braucht.
const TABLE = "catalog.manufacturer";
interface TestDB {
  [TABLE]: { id: Generated<string>; tenant_id: string; name: string; created_by: Generated<string | null> };
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
const required = process.env["SHOP_REQUIRE_DB_TESTS"] === "true";

if (required && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const ACTOR = uuidv7();

describe.skipIf(adminUrl === undefined)("withTenantTransaction (echte Datenbank)", () => {
  const dbName = `kernel_test_${randomBytes(4).toString("hex")}`;
  const appPassword = randomBytes(24).toString("hex");
  let admin: pg.Client;
  let database: Database<TestDB>;
  let appUrl: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;

    // Echtes Schema aller Module über den Migrationslauf, getestet wird als shop_app.
    await runMigrations({
      connectionString: setupUrl.href,
      rootDir: repoRoot,
      rolePasswords: { shop_app: appPassword },
    });

    // Zwei Shops anlegen (Plattform-Tabellen, Verwaltungsrolle).
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
    await setup.end();

    const u = new URL(setupUrl.href);
    u.username = "shop_app";
    u.password = appPassword;
    appUrl = u.href;
    database = connectDatabase<TestDB>({
      connectionString: appUrl,
      maxConnections: 3,
      applicationName: "kernel-test",
    });

    await withTenantTransaction(
      database,
      (trx) =>
        trx
          .insertInto(TABLE)
          .values([{ tenant_id: TENANT_A, name: "Tee A" }])
          .execute(),
      {
        tenantId: TENANT_A,
      },
    );
    await withTenantTransaction(
      database,
      (trx) =>
        trx
          .insertInto(TABLE)
          .values([{ tenant_id: TENANT_B, name: "Hemd B" }])
          .execute(),
      {
        tenantId: TENANT_B,
      },
    );
  }, 60_000);

  afterAll(async () => {
    await database?.destroy();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  const names = (tenantId: string) =>
    withTenantTransaction(database, (trx) => trx.selectFrom(TABLE).select("name").orderBy("name").execute(), {
      tenantId,
    }).then((rows) => rows.map((r) => r.name));

  it("jeder Shop sieht nur seine eigenen Zeilen", async () => {
    expect(await names(TENANT_A)).toEqual(["Tee A"]);
    expect(await names(TENANT_B)).toEqual(["Hemd B"]);
    expect(await names(uuidv7())).toEqual([]);
  });

  it("ohne Mandant liefert die Datenbank keine Zeilen (Regel schlägt geschlossen fehl)", async () => {
    const rows = await withPlatformTransaction(database, (trx) =>
      trx.selectFrom(TABLE).selectAll().execute(),
    );
    expect(rows).toEqual([]);
  });

  it("verbietet das Schreiben in einen fremden Shop", async () => {
    await expect(
      withTenantTransaction(
        database,
        (trx) => trx.insertInto(TABLE).values({ tenant_id: TENANT_B, name: "Einbruch" }).execute(),
        {
          tenantId: TENANT_A,
        },
      ),
    ).rejects.toThrow(/row-level security/);
    // Auch Ändern fremder Zeilen trifft nichts.
    const res = await withTenantTransaction(
      database,
      (trx) =>
        trx.updateTable(TABLE).set({ name: "geändert" }).where("tenant_id", "=", TENANT_B).executeTakeFirst(),
      { tenantId: TENANT_A },
    );
    expect(res.numUpdatedRows).toBe(0n);
    expect(await names(TENANT_B)).toEqual(["Hemd B"]);
  });

  it("rollt bei einem Fehler alles zurück", async () => {
    await expect(
      withTenantTransaction(
        database,
        async (trx) => {
          await trx.insertInto(TABLE).values({ tenant_id: TENANT_A, name: "Halbe Sache" }).execute();
          throw new Error("Abbruch");
        },
        { tenantId: TENANT_A },
      ),
    ).rejects.toThrow("Abbruch");
    expect(await names(TENANT_A)).toEqual(["Tee A"]);
  });

  it("der Mandant gilt nur für die Transaktion und bleibt nicht an der Verbindung hängen", async () => {
    const single = connectDatabase<TestDB>({ connectionString: appUrl, maxConnections: 1 });
    try {
      await withTenantTransaction(single, async () => undefined, { tenantId: TENANT_A, actorId: ACTOR });
      // Dieselbe Verbindung (Pool mit genau einer), jetzt ohne Transaktion: nichts mehr gesetzt.
      expect(await readSessionSettingForTest(single, "app.tenant_id")).toBeOneOf(["", null]);
      expect(await readSessionSettingForTest(single, "app.actor_id")).toBeOneOf(["", null]);
      // Und eine Transaktion ohne Mandant sieht keine Zeilen.
      const rows = await withPlatformTransaction(single, (trx) =>
        trx.selectFrom(TABLE).selectAll().execute(),
      );
      expect(rows).toEqual([]);
    } finally {
      await single.destroy();
    }
  });

  it("withUserTransaction setzt nur den Nutzer: keine Shopdaten, nichts bleibt an der Verbindung", async () => {
    const single = connectDatabase<TestDB>({ connectionString: appUrl, maxConnections: 1 });
    try {
      const inside = await withUserTransaction(single, ACTOR, async (trx) => {
        const r = await sql<{ u: string | null; a: string | null; t: string | null }>`
          select kernel.current_user_id()::text as u, kernel.current_actor_id()::text as a,
                 kernel.current_tenant_id()::text as t`.execute(trx);
        const rows = await trx.selectFrom(TABLE).selectAll().execute();
        return { ...r.rows[0], rows: rows.length };
      });
      expect(inside).toEqual({ u: ACTOR, a: ACTOR, t: null, rows: 0 });
      expect(await readSessionSettingForTest(single, "app.user_id")).toBeOneOf(["", null]);
      await expect(withUserTransaction(single, "kein-uuid", async () => 1)).rejects.toThrow(TypeError);
    } finally {
      await single.destroy();
    }
  });

  it("withApiTokenTransaction setzt nur den Token-Hash: kein Shop, kein Akteur, nichts bleibt hängen", async () => {
    const single = connectDatabase<TestDB>({ connectionString: appUrl, maxConnections: 1 });
    const hash = new Uint8Array(32).fill(0xab);
    try {
      const inside = await withApiTokenTransaction(single, hash, async (trx) => {
        const r = await sql<{ h: string | null; a: string | null; t: string | null; u: string | null }>`
          select encode(kernel.current_api_token_hash(), 'hex') as h, kernel.current_actor_id()::text as a,
                 kernel.current_tenant_id()::text as t, kernel.current_user_id()::text as u`.execute(trx);
        const rows = await trx.selectFrom(TABLE).selectAll().execute();
        return { ...r.rows[0], rows: rows.length };
      });
      expect(inside).toEqual({ h: "ab".repeat(32), a: null, t: null, u: null, rows: 0 });
      expect(await readSessionSettingForTest(single, "app.api_token_hash")).toBeOneOf(["", null]);
      // Andere Transaktionen setzen den Hash ausdrücklich leer.
      const inTenant = await withTenantTransaction(
        single,
        async (trx) => (await sql<{ h: string | null }>`select kernel.current_api_token_hash() as h`.execute(trx)).rows[0]?.h,
        { tenantId: TENANT_A },
      );
      expect(inTenant).toBeNull();
      await expect(withApiTokenTransaction(single, new Uint8Array(16), async () => 1)).rejects.toThrow(TypeError);
    } finally {
      await single.destroy();
    }
  });

  it("übersteht abgebrochene Verbindungen ohne Absturz und verbindet neu", async () => {
    const errors: string[] = [];
    const db = connectDatabase<TestDB>({
      connectionString: appUrl,
      maxConnections: 1,
      applicationName: "kernel-test-abbruch",
      onConnectionError: (e) => errors.push((e as Error & { code?: string }).code ?? e.message),
    });
    try {
      expect(await withTenantTransaction(db, async () => 1, { tenantId: TENANT_A })).toBe(1);
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'kernel-test-abbruch'",
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(errors).toEqual(["57P01"]);
      const rows = await withTenantTransaction(db, (trx) => trx.selectFrom(TABLE).select("name").execute(), {
        tenantId: TENANT_A,
      });
      expect(rows.map((r) => r.name)).toContain("Tee A");
    } finally {
      await db.destroy();
    }
  });

  it("setzt den Urheber für created_by", async () => {
    const row = await withTenantTransaction(
      database,
      (trx) =>
        trx
          .insertInto(TABLE)
          .values({ tenant_id: TENANT_A, name: "Mit Urheber" })
          .returning("created_by")
          .executeTakeFirstOrThrow(),
      { tenantId: TENANT_A, actorId: ACTOR },
    );
    expect(row.created_by).toBe(ACTOR);
  });

  it("nimmt Mandant und Urheber aus dem Anfrage-Kontext", async () => {
    const result = await runWithContext(
      { requestId: "r1", tenantId: TENANT_B, actor: { type: "user", id: ACTOR } },
      () => withTenantTransaction(database, (trx) => trx.selectFrom(TABLE).select("name").execute()),
    );
    expect(result.map((r) => r.name)).toEqual(["Hemd B"]);
  });

  it("trennt Mandanten auch bei vielen gleichzeitigen Transaktionen", async () => {
    const jobs = Array.from({ length: 30 }, (_, i) => {
      const tenantId = i % 2 === 0 ? TENANT_A : TENANT_B;
      return withTenantTransaction(
        database,
        async (trx) => {
          await sql`select pg_sleep(0.01)`.execute(trx);
          const rows = await trx.selectFrom(TABLE).select("tenant_id").distinct().execute();
          return { tenantId, seen: rows.map((r) => r.tenant_id) };
        },
        { tenantId },
      );
    });
    for (const { tenantId, seen } of await Promise.all(jobs)) expect(seen).toEqual([tenantId]);
  });
});

describe("withTenantTransaction ohne Datenbankkontakt", () => {
  // Zeigt auf einen Port, an dem nichts läuft: Jeder Verbindungsversuch würde ECONNREFUSED ergeben.
  const unreachable = connectDatabase<TestDB>({ connectionString: "postgres://niemand@127.0.0.1:1/keine" });
  afterAll(() => unreachable.destroy());

  it("verweigert den Zugriff ohne Mandant, bevor die Datenbank gefragt wird", async () => {
    await expect(withTenantTransaction(unreachable, async () => 1)).rejects.toBeInstanceOf(
      MissingTenantError,
    );
    await expect(withTenantTransaction(unreachable, async () => 1, { tenantId: "" })).rejects.toBeInstanceOf(
      MissingTenantError,
    );
  });

  it("lehnt Mandanten und Urheber ab, die keine UUID sind (auch SQL-Injection-Versuche)", async () => {
    await expect(
      withTenantTransaction(unreachable, async () => 1, { tenantId: "' OR 1=1 --" }),
    ).rejects.toThrow("tenantId muss eine UUID sein");
    await expect(
      withTenantTransaction(unreachable, async () => 1, { tenantId: TENANT_A, actorId: "admin" }),
    ).rejects.toThrow("actorId muss eine UUID sein");
  });

  it("ist nach dem Schließen nicht mehr benutzbar", async () => {
    const db = connectDatabase<TestDB>({ connectionString: "postgres://niemand@127.0.0.1:1/keine" });
    await db.destroy();
    await expect(withTenantTransaction(db, async () => 1, { tenantId: TENANT_A })).rejects.toThrow(
      /geschlossen/,
    );
  });
});
