// Tests für den Migrationslauf (Etappe E3, BET-01, PLA-03).
// Prüfregeln für Dateien laufen immer, alles mit Datenbank nur mit SHOP_TEST_DATABASE_URL.
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findMigrationDirs,
  loadMigrations,
  MigrationError,
  runMigrations,
  scramSha256Verifier,
  type MigrationDir,
} from "./migrate.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
const required = process.env["SHOP_REQUIRE_DB_TESTS"] === "true";
if (required && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Baut ein kleines Repository mit db/roles.sql und den angegebenen Migrationen eines Moduls. */
function fixture(files: Record<string, string>, module = "demo"): string {
  const root = mkdtempSync(join(tmpdir(), "shop-migrate-"));
  temps.push(root);
  mkdirSync(join(root, "db"));
  cpSync(join(repoRoot, "db", "roles.sql"), join(root, "db", "roles.sql"));
  const dir = join(root, "modules", module, "migrations");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return root;
}

function dirsOf(files: Record<string, string>, module = "demo"): MigrationDir[] {
  return findMigrationDirs(fixture(files, module));
}

describe("Prüfregeln für Migrationsdateien", () => {
  it("findet die echten Migrationen aller Module in der richtigen Reihenfolge", () => {
    const files = loadMigrations(findMigrationDirs(repoRoot));
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files[0]?.module).toBe("kernel");
    expect(files[1]?.module).toBe("platform");
    expect(new Set(files.map((f) => f.module)).size).toBe(20);
    expect(files.map((f) => f.name)).toEqual([...files.map((f) => f.name)].sort());
  });

  it.each([
    ["falscher Name", { "create_product.sql": "SELECT 1;" }, "Name muss"],
    ["psql-Befehl", { "20261101T120000_a.sql": "\\set ON_ERROR_STOP on\nSELECT 1;" }, "psql"],
    ["SET ROLE", { "20261101T120000_a.sql": "SET ROLE postgres;" }, "SET ROLE"],
    ["RESET ROLE", { "20261101T120000_a.sql": "reset role;" }, "SET ROLE"],
    ["Transaktion", { "20261101T120000_a.sql": "COMMIT;\nSELECT 1;" }, "Transaktionen"],
    ["Rolle anlegen", { "20261101T120000_a.sql": "CREATE ROLE evil SUPERUSER;" }, "Rollen"],
    ["Passwort", { "20261101T120000_a.sql": "ALTER USER x WITH PASSWORD 'geheim';" }, "Passwörter"],
    ["leere Datei", { "20261101T120000_a.sql": "-- nur Kommentar\n" }, "leer"],
    ["andere Dateiart", { "20261101T120000_a.ts": "export {}" }, ".sql"],
  ])("lehnt ab: %s", (_label, files, message) => {
    expect(() => loadMigrations(dirsOf(files))).toThrow(MigrationError);
    expect(() => loadMigrations(dirsOf(files))).toThrow(message);
  });

  it("erlaubt die verbotenen Wörter in Kommentaren", () => {
    const files = loadMigrations(
      dirsOf({ "20261101T120000_a.sql": "-- kein SET ROLE, kein COMMIT;\nSELECT 1;" }),
    );
    expect(files).toHaveLength(1);
  });

  it("lehnt denselben Namen in zwei Modulen ab", () => {
    const root = fixture({ "20261101T120000_same.sql": "SELECT 1;" }, "a");
    mkdirSync(join(root, "modules", "b", "migrations"), { recursive: true });
    writeFileSync(join(root, "modules", "b", "migrations", "20261101T120000_same.sql"), "SELECT 2;");
    expect(() => loadMigrations(findMigrationDirs(root))).toThrow("gleicher Name");
  });

  it("erzeugt einen SCRAM-Prüfwert und lehnt schwache Passwörter ab", () => {
    const v = scramSha256Verifier("A".repeat(20), Buffer.alloc(16, 1));
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(v).not.toContain("AAAA".repeat(5));
    expect(() => scramSha256Verifier("kurz")).toThrow(MigrationError);
    expect(() => scramSha256Verifier("mit leerzeichen 12345")).toThrow(MigrationError);
  });
});

describe.skipIf(adminUrl === undefined)("Migrationslauf mit echter Datenbank", () => {
  let admin: pg.Client;
  const created: string[] = [];

  async function freshDatabase(): Promise<string> {
    const name = `migrate_test_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    created.push(name);
    const url = new URL(adminUrl ?? "");
    url.pathname = `/${name}`;
    return url.href;
  }

  async function query<T extends pg.QueryResultRow>(
    url: string,
    text: string,
    values?: unknown[],
  ): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<T>(text, values)).rows;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  describe("echtes Schema aller Module", () => {
    let url: string;
    const appPassword = randomBytes(24).toString("hex");

    beforeAll(async () => {
      url = await freshDatabase();
      const result = await runMigrations({
        connectionString: url,
        rootDir: repoRoot,
        rolePasswords: { shop_app: appPassword },
      });
      expect(result.applied.length).toBeGreaterThanOrEqual(20);
      expect(result.alreadyApplied).toBe(0);
    }, 60_000);

    it("ein zweiter Lauf ändert nichts", async () => {
      const again = await runMigrations({ connectionString: url, rootDir: repoRoot });
      expect(again.applied).toEqual([]);
      expect(again.alreadyApplied).toBeGreaterThanOrEqual(20);
    });

    it("legt 20 Schemas und 112 Tabellen an, 93 davon mit Mandantentrennung, dazu die Warteschlange", async () => {
      const [row] = await query<{ schemas: string; tables: string; rls: string; queue: string }>(
        url,
        `SELECT (SELECT count(*) FROM pg_namespace WHERE nspowner = 'shop_owner'::regrole AND nspname <> 'pgboss') AS schemas,
                count(*) FILTER (WHERE n.nspname <> 'pgboss') AS tables,
                count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity) AS rls,
                count(*) FILTER (WHERE n.nspname = 'pgboss') AS queue
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p') AND n.nspowner = 'shop_owner'::regrole`,
      );
      expect(Number(row?.schemas)).toBe(20);
      expect(Number(row?.tables)).toBe(112);
      expect(Number(row?.rls)).toBe(93);
      // pg-boss (Etappe E5): eigenes Schema, gehört ebenfalls shop_owner, ohne RLS (db/global-tables.yaml).
      expect(Number(row?.queue)).toBeGreaterThan(5);
    });

    it("jede Tabelle mit tenant_id hat RLS mit FORCE und eine Regel (T-01)", async () => {
      // Ausnahmen: Plattform-Tabellen, die zwar auf einen Shop zeigen, aber von der Plattform
      // verwaltet werden. Shops dürfen sie lesen (Shop-Erkennung über die Adresse), nie schreiben.
      const platformManaged = ["platform.tenant_domain", "platform.tenant_feature_override"];
      const rows = await query<{ table: string }>(
        url,
        `SELECT format('%I.%I', n.nspname, c.relname) AS table
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
          WHERE c.relkind IN ('r','p') AND n.nspowner = 'shop_owner'::regrole
            AND format('%I.%I', n.nspname, c.relname) <> ALL ($1)
            AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`,
        [platformManaged],
      );
      expect(rows).toEqual([]);
    });

    it("alle Tabellen, Sichten und Funktionen gehören shop_owner", async () => {
      const rows = await query<{ object: string }>(
        url,
        `SELECT format('%I.%I', n.nspname, c.relname) AS object
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','public','shop_migration')
            AND c.relowner <> 'shop_owner'::regrole
         UNION ALL
         SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema','public','shop_migration')
            AND p.proowner <> 'shop_owner'::regrole`,
      );
      expect(rows).toEqual([]);
    });

    it("Anwendungsrolle meldet sich mit gesetztem Passwort an, sieht aber die Buchführung nicht", async () => {
      const appUrl = new URL(url);
      appUrl.username = "shop_app";
      appUrl.password = appPassword;
      const rows = await query<{ who: string; can: boolean }>(
        appUrl.href,
        `SELECT current_user AS who, has_schema_privilege('shop_migration', 'USAGE') AS can`,
      );
      expect(rows).toEqual([{ who: "shop_app", can: false }]);
      appUrl.password = "falsch-falsch-falsch";
      await expect(query(appUrl.href, "SELECT 1")).rejects.toThrow(/password authentication failed/);
    });

    it("Referenzdaten sind da (Währungen, Länder, Steuersätze, Theme, Tarif)", async () => {
      const [row] = await query<Record<string, string>>(
        url,
        `SELECT (SELECT count(*) FROM kernel.currency) AS currency, (SELECT count(*) FROM kernel.country) AS country,
                (SELECT count(*) FROM tax.tax_rate) AS tax_rate, (SELECT count(*) FROM storefront.theme) AS theme,
                (SELECT count(*) FROM platform.plan WHERE is_default) AS plan`,
      );
      expect(row).toEqual({ currency: "9", country: "30", tax_rate: "8", theme: "1", plan: "1" });
    });
  });

  it("mehrere Datenbanken auf demselben Server lassen sich gleichzeitig einrichten (Rollen sind serverweit)", async () => {
    const urls = await Promise.all([freshDatabase(), freshDatabase(), freshDatabase(), freshDatabase()]);
    const results = await Promise.all(urls.map((u) => runMigrations({ connectionString: u, rootDir: repoRoot })));
    for (const r of results) expect(r.applied.length).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it("übernimmt nichts, wenn eine Migration scheitert", async () => {
    const url = await freshDatabase();
    const root = fixture({
      "20261101T120000_ok.sql": "CREATE SCHEMA demo; CREATE TABLE demo.a (id int);",
      "20261101T120100_broken.sql": "CREATE TABLE demo.b (id int); SELECT 1/0;",
    });
    await expect(runMigrations({ connectionString: url, rootDir: root })).rejects.toThrow(
      /20261101T120100_broken gescheitert, nichts wurde übernommen/,
    );
    const rows = await query<{ n: string }>(
      url,
      `SELECT (SELECT count(*) FROM pg_namespace WHERE nspname = 'demo')
            + (SELECT count(*) FROM shop_migration.checksum) AS n`,
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("bricht ab, wenn eine ausgeführte Migration nachträglich geändert wurde", async () => {
    const url = await freshDatabase();
    const root = fixture({ "20261101T120000_a.sql": "CREATE SCHEMA demo;" });
    await runMigrations({ connectionString: url, rootDir: root });
    writeFileSync(
      join(root, "modules", "demo", "migrations", "20261101T120000_a.sql"),
      "CREATE SCHEMA demo2;",
    );
    await expect(runMigrations({ connectionString: url, rootDir: root })).rejects.toThrow(
      /nachträglich geändert/,
    );
  });

  it("bricht ab, wenn eine ausgeführte Migration fehlt oder eine ältere nachgereicht wird", async () => {
    const url = await freshDatabase();
    const root = fixture({ "20261101T120000_a.sql": "CREATE SCHEMA demo;" });
    await runMigrations({ connectionString: url, rootDir: root });
    const dir = join(root, "modules", "demo", "migrations");
    writeFileSync(join(dir, "20261001T120000_older.sql"), "CREATE SCHEMA demo_old;");
    await expect(runMigrations({ connectionString: url, rootDir: root })).rejects.toThrow(/gescheitert/);
    rmSync(join(dir, "20261001T120000_older.sql"));
    rmSync(join(dir, "20261101T120000_a.sql"));
    await expect(runMigrations({ connectionString: url, rootDir: root })).rejects.toThrow(/gescheitert/);
  });

  it("Objekte gehören shop_owner, auch wenn die Datei das nicht sagt", async () => {
    const url = await freshDatabase();
    const root = fixture({ "20261101T120000_a.sql": "CREATE SCHEMA demo; CREATE TABLE demo.t (id int);" });
    await runMigrations({ connectionString: url, rootDir: root });
    const rows = await query<{ owner: string }>(
      url,
      `SELECT tableowner AS owner FROM pg_tables WHERE tablename = 't'`,
    );
    expect(rows).toEqual([{ owner: "shop_owner" }]);
  });

  it("drei gleichzeitige Läufe führen jede Migration genau einmal aus", async () => {
    const url = await freshDatabase();
    const root = fixture({
      "20261101T120000_a.sql": "CREATE SCHEMA demo; CREATE TABLE demo.t (id int); SELECT pg_sleep(0.3);",
      "20261101T120100_b.sql": "INSERT INTO demo.t VALUES (1);",
    });
    const results = await Promise.all(
      [1, 2, 3].map(() => runMigrations({ connectionString: url, rootDir: root })),
    );
    expect(results.map((r) => r.applied.length).sort()).toEqual([0, 0, 2]);
    const rows = await query<{ n: string }>(url, "SELECT count(*) AS n FROM demo.t");
    expect(rows[0]?.n).toBe("1");
  });
});
