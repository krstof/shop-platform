// Migrationslauf (Architektur 6.1 und 7.1, BET-01, Etappe E3).
//
// Ablauf auf genau einer Verbindung mit der Verwaltungsrolle:
//   1. Sperre holen (pg_advisory_lock), damit zwei gleichzeitige Läufe nacheinander arbeiten.
//   2. db/roles.sql ausführen: Rollen, Erweiterungen, Rechte auf der Datenbank (darf oft laufen).
//   3. Passwörter der Anmelderollen setzen, als SCRAM-Prüfwert (das Passwort selbst
//      erreicht die Datenbank nie und landet deshalb auch in keinem Protokoll).
//   4. Prüfsummen vergleichen: Eine schon ausgeführte Migration darf sich nie mehr ändern.
//   5. Neue Migrationen mit dem Migrator von Kysely ausführen, alle zusammen in EINER
//      Transaktion. Scheitert eine, wird nichts übernommen.
// Jede Migration läuft als `shop_owner`, damit alle Objekte dieser Rolle gehören.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import pg from "pg";

/** Schema für die Buchführung des Migrationslaufs. Keine Anwendungsrolle hat darauf Zugriff. */
export const MIGRATION_SCHEMA = "shop_migration";
/** Rolle, der alle Objekte gehören (Architektur 5.6). */
export const OWNER_ROLE = "shop_owner";
/** Anmelderollen, deren Passwort der Migrationslauf setzen darf. */
export const LOGIN_ROLES = ["shop_app", "shop_platform", "shop_auth", "shop_relay", "shop_backup"] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

const NAME_PATTERN = /^\d{8}T\d{6}_[a-z0-9_]+$/;
const LOCK_KEY = 4_711_000_001; // feste Kennung der Sperre für den Migrationslauf

export interface MigrationFile {
  /** Dateiname ohne `.sql`, eindeutig über alle Module, bestimmt die Reihenfolge. */
  readonly name: string;
  /** Modul, zu dem die Migration gehört (`kernel` oder Ordnername unter `modules/`). */
  readonly module: string;
  readonly path: string;
  readonly sql: string;
  /** SHA-256 des Dateiinhalts, hexadezimal. */
  readonly sha256: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationDir {
  readonly module: string;
  readonly dir: string;
}

/** Sucht die Migrationsordner: erst der Kernel, dann alle Module unter `modules/`. */
export function findMigrationDirs(rootDir: string): MigrationDir[] {
  const dirs: MigrationDir[] = [];
  const kernelDir = join(rootDir, "packages", "kernel", "migrations");
  if (existsSync(kernelDir)) dirs.push({ module: "kernel", dir: kernelDir });
  const modulesDir = join(rootDir, "modules");
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir).sort()) {
      const dir = join(modulesDir, entry, "migrations");
      if (existsSync(dir) && statSync(dir).isDirectory()) dirs.push({ module: entry, dir });
    }
  }
  return dirs;
}

// Verbotene Inhalte. Der Migrationslauf bestimmt Rolle und Transaktion selbst; eine Datei,
// die das ändert, könnte Objekte mit falschem Besitzer anlegen oder die Gesamt-Transaktion aufbrechen.
const FORBIDDEN: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /^\s*\\/m, reason: "psql-Befehle (Zeilen mit \\) gehen nur in psql, nicht im Migrationslauf" },
  {
    pattern: /\b(SET|RESET)\s+(LOCAL\s+|SESSION\s+)?ROLE\b/i,
    reason: "SET ROLE ist Sache des Migrationslaufs",
  },
  { pattern: /\bSESSION\s+AUTHORIZATION\b/i, reason: "SESSION AUTHORIZATION ist verboten" },
  {
    pattern: /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/im,
    reason: "Transaktionen steuert der Migrationslauf",
  },
  { pattern: /\b(CREATE|ALTER|DROP)\s+ROLE\b/i, reason: "Rollen stehen nur in db/roles.sql" },
  { pattern: /\bPASSWORD\b/i, reason: "Passwörter gehören nicht in Migrationen" },
];

/** Entfernt Kommentare grob, damit erklärende Kommentare die Prüfung nicht auslösen. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Liest und prüft alle Migrationen. Fehler werden gesammelt und zusammen gemeldet. */
export function loadMigrations(dirs: readonly MigrationDir[]): MigrationFile[] {
  const problems: string[] = [];
  const byName = new Map<string, MigrationFile>();
  for (const { module, dir } of dirs) {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (!entry.endsWith(".sql")) {
        problems.push(`${module}/${entry}: nur .sql-Dateien sind erlaubt`);
        continue;
      }
      const name = basename(entry, ".sql");
      if (!NAME_PATTERN.test(name)) {
        problems.push(`${module}/${entry}: Name muss so aussehen: 20261101T120000_create_product.sql`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      const code = stripComments(content);
      for (const { pattern, reason } of FORBIDDEN) {
        if (pattern.test(code)) problems.push(`${module}/${entry}: ${reason}`);
      }
      if (code.trim() === "") problems.push(`${module}/${entry}: Datei ist leer`);
      const other = byName.get(name);
      if (other !== undefined) {
        problems.push(`${module}/${entry}: gleicher Name wie in Modul ${other.module}`);
        continue;
      }
      byName.set(name, {
        name,
        module,
        path,
        sql: content,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  }
  if (problems.length > 0)
    throw new MigrationError(`Migrationen fehlerhaft:\n  - ${problems.join("\n  - ")}`);
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Erzeugt den SCRAM-SHA-256-Prüfwert, den PostgreSQL statt des Passworts speichert (RFC 7677).
 * Nur druckbare ASCII-Zeichen, damit keine Unicode-Normalisierung (SASLprep) nötig ist.
 */
export function scramSha256Verifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  if (!/^[\x21-\x7e]{16,}$/.test(password)) {
    throw new MigrationError("Passwort muss mindestens 16 druckbare ASCII-Zeichen ohne Leerzeichen haben");
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export interface RunMigrationsOptions {
  /** Verwaltungsrolle (darf Rollen anlegen), zum Beispiel `postgres`. */
  readonly connectionString: string;
  /** Wurzel des Repositorys bzw. des Container-Abbilds mit `db/` und den Migrationsordnern. */
  readonly rootDir: string;
  /** Passwörter für Anmelderollen. Fehlende Rollen bleiben unverändert. */
  readonly rolePasswords?: Partial<Record<LoginRole, string>>;
  /** Höchstens so lange auf Tabellensperren warten. Standard 10 Sekunden. */
  readonly lockTimeoutMs?: number;
  /** Meldungen über den Fortschritt. */
  readonly log?: (message: string, details?: Record<string, unknown>) => void;
}

export interface RunMigrationsResult {
  /** Namen der in diesem Lauf ausgeführten Migrationen. */
  readonly applied: readonly string[];
  /** Anzahl der Migrationen, die schon vorher ausgeführt waren. */
  readonly alreadyApplied: number;
}

class SqlFileProvider implements MigrationProvider {
  constructor(private readonly files: readonly MigrationFile[]) {}
  getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    for (const file of this.files) {
      migrations[file.name] = {
        up: async (db) => {
          // SET LOCAL gilt nur bis zum Ende der Transaktion; RESET ROLE schaltet direkt zurück,
          // damit die Buchführung wieder als Verwaltungsrolle geschrieben wird.
          await sql.raw(`SET LOCAL ROLE ${OWNER_ROLE}`).execute(db);
          await sql.raw(file.sql).execute(db);
          await sql.raw("RESET ROLE").execute(db);
          await sql`INSERT INTO ${sql.table(`${MIGRATION_SCHEMA}.checksum`)} (name, module, sha256)
                    VALUES (${file.name}, ${file.module}, ${file.sha256})`.execute(db);
        },
        // Bewusst kein `down`: Migrationen laufen nur vorwärts (BET-01). Korrekturen sind neue Migrationen.
      };
    }
    return Promise.resolve(migrations);
  }
}

/**
 * Legt die Datenbank an, falls es sie noch nicht gibt (für `pnpm dev` und frische Server).
 * Verbindet sich dafür mit der Verwaltungsdatenbank `postgres` auf demselben Server.
 * Gibt `true` zurück, wenn die Datenbank neu angelegt wurde.
 */
export async function ensureDatabase(connectionString: string): Promise<boolean> {
  const target = new URL(connectionString);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new MigrationError("Datenbankname darf nur Kleinbuchstaben, Ziffern und _ enthalten");
  }
  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.href, application_name: "shop-migrate" });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount !== 0) return false;
    await client.query(`CREATE DATABASE ${name}`);
    return true;
  } finally {
    await client.end();
  }
}

/** Führt Grundlage und alle neuen Migrationen aus. Darf beliebig oft und gleichzeitig laufen. */
/**
 * Rollen gelten für den ganzen Server, die Sperre oben nur für eine Datenbank. Richten zwei
 * Datenbanken auf demselben Server gleichzeitig ein (parallele Tests, mehrere Umgebungen), kann
 * eine Rolle zwischen Prüfung und Anlegen entstehen; PostgreSQL meldet dann eine doppelte Rolle.
 * roles.sql ist wiederholbar, also einfach noch einmal versuchen (am 03.11.2026 so gesehen).
 */
async function runRolesSql(run: () => Promise<unknown>, attempts = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await run();
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const race = code === "23505" || code === "42710" || code === "XX000" || code === "40001";
      if (!race || i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 50 * i));
    }
  }
}

export async function runMigrations(options: RunMigrationsOptions): Promise<RunMigrationsResult> {
  const log = options.log ?? (() => undefined);
  const files = loadMigrations(findMigrationDirs(options.rootDir));
  const rolesSql = readFileSync(join(options.rootDir, "db", "roles.sql"), "utf8");
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 1,
    application_name: "shop-migrate",
    // Migrationen dürfen lange laufen, aber nicht ewig auf Sperren warten.
    statement_timeout: 0,
    lock_timeout: options.lockTimeoutMs ?? 10_000,
  });
  pool.on("error", () => undefined); // abgebrochene ruhende Verbindung: Fehler kommt beim nächsten Aufruf
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    return await db.connection().execute(async (conn) => {
      await sql`SELECT pg_advisory_lock(${LOCK_KEY})`.execute(conn);
      try {
        await sql.raw("SET client_min_messages = warning").execute(conn);
        await runRolesSql(() => sql.raw(rolesSql).execute(conn));
        log("Rollen und Grundrechte geprüft");

        for (const role of LOGIN_ROLES) {
          const password = options.rolePasswords?.[role];
          if (password === undefined) continue;
          await sql.raw(`ALTER ROLE ${role} PASSWORD '${scramSha256Verifier(password)}'`).execute(conn);
        }

        await sql.raw(`CREATE SCHEMA IF NOT EXISTS ${MIGRATION_SCHEMA}`).execute(conn);
        await sql.raw(`REVOKE ALL ON SCHEMA ${MIGRATION_SCHEMA} FROM PUBLIC`).execute(conn);
        await sql
          .raw(
            `CREATE TABLE IF NOT EXISTS ${MIGRATION_SCHEMA}.checksum (
               name text PRIMARY KEY, module text NOT NULL, sha256 text NOT NULL,
               applied_at timestamptz NOT NULL DEFAULT now())`,
          )
          .execute(conn);

        const applied = await sql<{ name: string; sha256: string }>`
          SELECT name, sha256 FROM ${sql.table(`${MIGRATION_SCHEMA}.checksum`)}`.execute(conn);
        const byName = new Map(files.map((f) => [f.name, f]));
        const changed: string[] = [];
        for (const row of applied.rows) {
          const file = byName.get(row.name);
          if (file !== undefined && file.sha256 !== row.sha256) changed.push(row.name);
        }
        if (changed.length > 0) {
          throw new MigrationError(
            `Schon ausgeführte Migrationen wurden nachträglich geändert: ${changed.join(", ")}. ` +
              "Änderungen gehören in eine neue Migration.",
          );
        }

        const migrator = new Migrator({
          db: conn,
          provider: new SqlFileProvider(files),
          migrationTableSchema: MIGRATION_SCHEMA,
        });
        const { error, results } = await migrator.migrateToLatest();
        if (error !== undefined) {
          const failed = results?.find((r) => r.status === "Error")?.migrationName;
          const reason = error instanceof Error ? error.message : String(error);
          throw new MigrationError(
            failed === undefined
              ? `Migrationslauf gescheitert: ${reason}`
              : `Migration ${failed} gescheitert, nichts wurde übernommen: ${reason}`,
          );
        }
        const done = (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
        for (const name of done) log("Migration ausgeführt", { name, module: byName.get(name)?.module });
        return { applied: done, alreadyApplied: applied.rows.length };
      } finally {
        await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.execute(conn);
      }
    });
  } finally {
    await db.destroy();
  }
}
