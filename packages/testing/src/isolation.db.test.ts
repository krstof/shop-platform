// Isolations- und Rechtetest (T-01 bis T-05, Sicherheit 7, Datenmodell 6) mit eigener
// Wegwerf-Datenbank per Testcontainers. Ersetzt tools/db-test.sh und db/test_isolation.sh;
// die eigentlichen Prüfungen stehen weiter in db/test_isolation.sql und db/test_sicherheit.sql.
//
// Ablauf: Container starten, Datenbank mit dem Dienst migrate einrichten, zwei Shops anlegen,
// dann alle Prüfungen. Die Liste der Tabellen ohne Mandant kommt aus db/global-tables.yaml.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot, startTestDatabase, type PsqlResult, type TestDatabase } from "./postgres.js";

const DB = "shop_isolation_test";
const A = "0192f000-0000-7000-8000-00000000000a";
const B = "0192f000-0000-7000-8000-00000000000b";
const APP_PASSWORD = randomBytes(24).toString("hex");
const APP = { user: "shop_app", password: APP_PASSWORD };

function globalList(kind: "schemas" | "tables"): string {
  const r = spawnSync(process.execPath, [join(repoRoot, "tools/global-tables.mjs"), kind], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`db/global-tables.yaml ungültig:\n${r.stderr}`);
  return r.stdout.trim();
}

/** Prüfzeilen der SQL-Dateien („OK …“), ohne die Vorsilben von psql. */
function checkLines(r: PsqlResult): string[] {
  return r.output
    .split("\n")
    .map((l) => l.replace(/^psql:[^ ]* /, "").replace(/^(NOTICE|HINWEIS): {2}/, ""))
    .filter((l) => /^(OK|FEHL)/.test(l) || l.startsWith("ERROR") || l.startsWith("FEHLER"));
}

function expectAllOk(r: PsqlResult, minChecks: number): void {
  const lines = checkLines(r);
  console.log(lines.join("\n"));
  expect(
    lines.filter((l) => !l.startsWith("OK")),
    r.output,
  ).toEqual([]);
  expect(r.exitCode, r.output).toBe(0);
  expect(lines.length).toBeGreaterThanOrEqual(minChecks);
}

let db: TestDatabase;
const admin = (sql: string): Promise<PsqlResult> => db.psql(DB, ["-q", "-v", "ON_ERROR_STOP=1", "-c", sql]);

beforeAll(async () => {
  db = await startTestDatabase({ copyDirs: ["db"] });
  await db.migrate(DB);

  // Nur für diesen Test: Passwort für shop_app, damit wir uns echt als shop_app anmelden.
  const steps = [
    `ALTER ROLE shop_app PASSWORD '${APP_PASSWORD}'`,
    // Zwei Händler und Shops (als shop_platform)
    `SET ROLE shop_platform;
     WITH m AS (INSERT INTO platform.merchant (name) VALUES ('Händler A') RETURNING id)
     INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
     SELECT '${A}', m.id, p.id, 'teeladen-a', 'Teeladen A', 'active' FROM m, platform.plan p WHERE p.is_default;
     WITH m AS (INSERT INTO platform.merchant (name) VALUES ('Händler B') RETURNING id)
     INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
     SELECT '${B}', m.id, p.id, 'teeladen-b', 'Teeladen B', 'active' FROM m, platform.plan p WHERE p.is_default;
     INSERT INTO platform.tenant_domain (tenant_id, hostname, kind, is_primary) VALUES
       ('${A}', 'teeladen-a.shop.localhost', 'subdomain', true),
       ('${B}', 'teeladen-b.shop.localhost', 'subdomain', true);
     -- Plattform-Eintrag ohne Mandant im Audit-Log: muss für Shops unsichtbar sein
     INSERT INTO audit.audit_entry (tenant_id, actor_type, action, entity_type)
       VALUES (NULL, 'operator', 'platform.tenant.created', 'tenant');`,
    // Inhaber-Konten (als shop_auth, das Anmeldemodul)
    `SET ROLE shop_auth;
     WITH u AS (
       INSERT INTO identity."user" (email, name) VALUES
         ('a@haendler.test', 'Inhaber a'), ('b@haendler.test', 'Inhaber b') RETURNING id, email)
     INSERT INTO identity.account (user_id, provider_id, account_id, password_hash)
     SELECT id, 'credential', email, '$argon2id$v=19$m=19456,t=2,p=1$dGVzdA$dGVzdA' FROM u;`,
  ];
  for (const sql of steps) {
    const r = await admin(sql);
    if (r.exitCode !== 0) throw new Error(`Vorbereitung fehlgeschlagen:\n${r.output}`);
  }
});

afterAll(async () => {
  await db?.stop();
});

describe("Datenbank: Mandantentrennung und Rechte (T-01 bis T-05)", () => {
  it("läuft auf PostgreSQL 18.6 und ist vollständig migriert", async () => {
    const v = await db.psql(DB, ["-tA", "-c", "SHOW server_version"]);
    expect(v.stdout.trim()).toMatch(/^18\.6/);
    const n = await db.psql(DB, ["-tA", "-c", "SELECT count(*) FROM shop_migration.checksum"]);
    expect(Number(n.stdout.trim())).toBeGreaterThanOrEqual(20);
  });

  it("trennt die Daten der Shops (db/test_isolation.sql als shop_app)", async () => {
    const r = await db.psql(
      DB,
      [
        "-v",
        `A=${A}`,
        "-v",
        `B=${B}`,
        "-v",
        `global_schemas=${globalList("schemas")}`,
        "-v",
        `global_tables=${globalList("tables")}`,
        "-f",
        "/repo/db/test_isolation.sql",
      ],
      { login: APP, env: { PGOPTIONS: `-c test.a=${A} -c test.b=${B}` } },
    );
    expectAllOk(r, 38);
  });

  it("gibt jeder Datenbankrolle nur ihre Rechte (db/test_sicherheit.sql)", async () => {
    const r = await db.psql(DB, ["-f", "/repo/db/test_sicherheit.sql"]);
    expectAllOk(r, 21);
  });

  it.each([
    "SELECT password_hash FROM identity.account",
    "SELECT token_hash FROM identity.session",
    'SELECT * FROM identity."user"',
    `UPDATE identity."user" SET status = 'active'`,
  ])("verweigert shop_app den Zugriff auf Anmeldedaten: %s", async (sql) => {
    const r = await db.psql(DB, ["-q", "-tA", "-c", sql], { login: APP });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toMatch(/permission denied|keine Berechtigung/);
  });

  it("lässt shop_app die erlaubten Spalten der Nutzer lesen (id, name, email)", async () => {
    const r = await db.psql(
      DB,
      ["-q", "-tA", "-c", 'SELECT count(*) FROM (SELECT id, name, email FROM identity."user") u'],
      { login: APP },
    );
    expect(r.exitCode, r.output).toBe(0);
    expect(r.stdout.trim()).toBe("2");
  });

  it("vergibt bei 20 gleichzeitigen Transaktionen lückenlose Nummern (5 brechen ab)", async () => {
    const tx = (end: "COMMIT" | "ROLLBACK"): Promise<PsqlResult> =>
      db.psql(
        DB,
        [
          "-q",
          "-tA",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "BEGIN",
          "-c",
          `SELECT set_config('app.tenant_id', '${A}', true) IS NULL`,
          "-c",
          "SELECT 'NR:' || shop_settings.next_number('delivery_note')",
          "-c",
          "SELECT pg_sleep(random() * 0.05) IS NULL",
          "-c",
          end,
        ],
        { login: APP },
      );
    const runs = await Promise.all([
      ...Array.from({ length: 20 }, () => tx("COMMIT")),
      ...Array.from({ length: 5 }, () => tx("ROLLBACK")),
    ]);
    for (const r of runs) expect(r.exitCode, r.output).toBe(0);
    const committed = runs
      .slice(0, 20)
      .flatMap((r) => r.stdout.split("\n"))
      .filter((l) => l.startsWith("NR:"))
      .map((l) => l.slice(3))
      .sort();
    const expected = Array.from({ length: 20 }, (_, i) => `L-${String(i + 1).padStart(4, "0")}`);
    expect(committed).toEqual(expected);

    // Abgebrochene Transaktionen haben keine Nummer verbraucht.
    const next = await db.psql(
      DB,
      [
        "-q",
        "-tA",
        "-c",
        "BEGIN",
        "-c",
        `SELECT set_config('app.tenant_id', '${A}', true) IS NULL`,
        "-c",
        "SELECT 'NR:' || shop_settings.next_number('delivery_note')",
        "-c",
        "ROLLBACK",
      ],
      { login: APP },
    );
    expect(next.stdout).toContain("NR:L-0021");
  });
});
