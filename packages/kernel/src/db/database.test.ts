// Integrationstest für withTenantTransaction mit echter PostgreSQL-Datenbank (Architektur 5.3).
// Braucht SHOP_TEST_DATABASE_URL (Superuser einer Wegwerf-Datenbank). In der CI ist sie
// gesetzt und SHOP_REQUIRE_DB_TESTS=true sorgt dafür, dass der Test nicht still übersprungen wird.
import { randomBytes } from "node:crypto";
import { sql, type Generated } from "kysely";
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
  type Database,
} from "./database.js";

interface TestDB {
  "demo.item": { id: Generated<string>; tenant_id: string; name: string; created_by: Generated<string | null> };
}

const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
const required = process.env["SHOP_REQUIRE_DB_TESTS"] === "true";

if (required && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const ACTOR = uuidv7();

describe.skipIf(adminUrl === undefined)("withTenantTransaction (echte Datenbank)", () => {
  const suffix = randomBytes(4).toString("hex");
  const dbName = `kernel_test_${suffix}`;
  const owner = `kt_owner_${suffix}`;
  const app = `kt_app_${suffix}`;
  const appPassword = randomBytes(24).toString("hex");
  let admin: pg.Client;
  let database: Database<TestDB>;
  let appUrl: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.query(`CREATE ROLE ${owner} NOLOGIN`);
    await admin.query(`CREATE ROLE ${app} LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${appPassword}'`);

    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    const setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    // Gleiches Muster wie db/schema_welle1.sql: Policy über app.tenant_id, RLS mit FORCE.
    await setup.query(`
      CREATE SCHEMA kernel AUTHORIZATION ${owner};
      CREATE SCHEMA demo AUTHORIZATION ${owner};
      SET ROLE ${owner};
      CREATE FUNCTION kernel.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
      CREATE FUNCTION kernel.current_actor_id() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;
      CREATE TABLE demo.item (
        tenant_id uuid NOT NULL,
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        name text NOT NULL,
        created_by uuid DEFAULT kernel.current_actor_id(),
        PRIMARY KEY (tenant_id, id)
      );
      ALTER TABLE demo.item ENABLE ROW LEVEL SECURITY;
      ALTER TABLE demo.item FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON demo.item
        USING (tenant_id = kernel.current_tenant_id())
        WITH CHECK (tenant_id = kernel.current_tenant_id());
      GRANT USAGE ON SCHEMA kernel, demo TO ${app};
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kernel TO ${app};
      GRANT SELECT, INSERT, UPDATE, DELETE ON demo.item TO ${app};
      RESET ROLE;
    `);
    await setup.end();

    const u = new URL(adminUrl ?? "");
    u.username = app;
    u.password = appPassword;
    u.pathname = `/${dbName}`;
    appUrl = u.href;
    database = connectDatabase<TestDB>({ connectionString: appUrl, maxConnections: 3, applicationName: "kernel-test" });

    await withTenantTransaction(database, (trx) => trx.insertInto("demo.item").values([{ tenant_id: TENANT_A, name: "Tee A" }]).execute(), {
      tenantId: TENANT_A,
    });
    await withTenantTransaction(database, (trx) => trx.insertInto("demo.item").values([{ tenant_id: TENANT_B, name: "Hemd B" }]).execute(), {
      tenantId: TENANT_B,
    });
  });

  afterAll(async () => {
    await database?.destroy();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${app}`);
      await admin.query(`DROP ROLE IF EXISTS ${owner}`);
      await admin.end();
    }
  });

  const names = (tenantId: string) =>
    withTenantTransaction(database, (trx) => trx.selectFrom("demo.item").select("name").orderBy("name").execute(), {
      tenantId,
    }).then((rows) => rows.map((r) => r.name));

  it("jeder Shop sieht nur seine eigenen Zeilen", async () => {
    expect(await names(TENANT_A)).toEqual(["Tee A"]);
    expect(await names(TENANT_B)).toEqual(["Hemd B"]);
    expect(await names(uuidv7())).toEqual([]);
  });

  it("ohne Mandant liefert die Datenbank keine Zeilen (Regel schlägt geschlossen fehl)", async () => {
    const rows = await withPlatformTransaction(database, (trx) => trx.selectFrom("demo.item").selectAll().execute());
    expect(rows).toEqual([]);
  });

  it("verbietet das Schreiben in einen fremden Shop", async () => {
    await expect(
      withTenantTransaction(database, (trx) => trx.insertInto("demo.item").values({ tenant_id: TENANT_B, name: "Einbruch" }).execute(), {
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(/row-level security/);
    // Auch Ändern fremder Zeilen trifft nichts.
    const res = await withTenantTransaction(
      database,
      (trx) => trx.updateTable("demo.item").set({ name: "geändert" }).where("tenant_id", "=", TENANT_B).executeTakeFirst(),
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
          await trx.insertInto("demo.item").values({ tenant_id: TENANT_A, name: "Halbe Sache" }).execute();
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
      const rows = await withPlatformTransaction(single, (trx) => trx.selectFrom("demo.item").selectAll().execute());
      expect(rows).toEqual([]);
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
      const rows = await withTenantTransaction(db, (trx) => trx.selectFrom("demo.item").select("name").execute(), {
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
      (trx) => trx.insertInto("demo.item").values({ tenant_id: TENANT_A, name: "Mit Urheber" }).returning("created_by").executeTakeFirstOrThrow(),
      { tenantId: TENANT_A, actorId: ACTOR },
    );
    expect(row.created_by).toBe(ACTOR);
  });

  it("nimmt Mandant und Urheber aus dem Anfrage-Kontext", async () => {
    const result = await runWithContext({ requestId: "r1", tenantId: TENANT_B, actor: { type: "user", id: ACTOR } }, () =>
      withTenantTransaction(database, (trx) => trx.selectFrom("demo.item").select("name").execute()),
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
          const rows = await trx.selectFrom("demo.item").select("tenant_id").distinct().execute();
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
    await expect(withTenantTransaction(unreachable, async () => 1)).rejects.toBeInstanceOf(MissingTenantError);
    await expect(withTenantTransaction(unreachable, async () => 1, { tenantId: "" })).rejects.toBeInstanceOf(
      MissingTenantError,
    );
  });

  it("lehnt Mandanten und Urheber ab, die keine UUID sind (auch SQL-Injection-Versuche)", async () => {
    await expect(withTenantTransaction(unreachable, async () => 1, { tenantId: "' OR 1=1 --" })).rejects.toThrow(
      "tenantId muss eine UUID sein",
    );
    await expect(
      withTenantTransaction(unreachable, async () => 1, { tenantId: TENANT_A, actorId: "admin" }),
    ).rejects.toThrow("actorId muss eine UUID sein");
  });

  it("ist nach dem Schließen nicht mehr benutzbar", async () => {
    const db = connectDatabase<TestDB>({ connectionString: "postgres://niemand@127.0.0.1:1/keine" });
    await db.destroy();
    await expect(withTenantTransaction(db, async () => 1, { tenantId: TENANT_A })).rejects.toThrow(/geschlossen/);
  });
});
