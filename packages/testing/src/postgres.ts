// Wegwerf-Datenbank für Tests (Architektur 8.1): PostgreSQL 18.6 per Testcontainers,
// eingerichtet mit dem echten Dienst migrate. Ersetzt die früheren Shell-Skripte
// tools/lib/pg-container.sh, tools/db-test.sh und tools/test-with-db.sh.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

/** Abbild mit fester Prüfsumme, damit jeder Lauf genau dasselbe PostgreSQL bekommt (Sicherheit 5.11). */
export const PG_IMAGE =
  "postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4";

/** Wurzel des Repositorys (gleich tief aus src/ und dist/). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Erlaubte Namen für Testdatenbanken: klein, ohne Anführungszeichen nutzbar. */
const DB_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export interface PsqlResult {
  exitCode: number;
  /** Ausgabe und Fehlerausgabe zusammen, in der Reihenfolge des Auftretens. */
  output: string;
  /** Gleich output (beide Ströme zusammen); Abfrageergebnisse daher mit Kennung ausgeben. */
  stdout: string;
}

export interface PsqlOptions {
  /** Anmeldung über TCP als diese Rolle statt als postgres über den lokalen Socket. */
  login?: { user: string; password: string };
  /** Zusätzliche Umgebungsvariablen für psql im Container (z. B. PGOPTIONS). */
  env?: Record<string, string>;
}

export interface TestDatabase {
  /** Adresse als Superuser postgres, für die angegebene Datenbank (Standard: postgres). */
  adminUrl(database?: string): string;
  /** Führt psql im Container aus (dort gibt es psql immer in der passenden Version). */
  psql(database: string, args: string[], options?: PsqlOptions): Promise<PsqlResult>;
  /** Legt die Datenbank an und migriert sie mit dem Dienst migrate. Liefert die Adresse. */
  migrate(database: string): Promise<string>;
  /** Hält den Container an und löscht ihn. */
  stop(): Promise<void>;
}

export interface StartOptions {
  /** Ordner im Repository, die schreibgeschützt nach /repo/<ordner> kopiert werden (z. B. "db"). */
  copyDirs?: string[];
}

function assertDbName(name: string): void {
  if (!DB_NAME.test(name)) throw new Error(`Ungültiger Datenbankname für Tests: ${name}`);
}

/** Baut den Dienst migrate, falls er noch nicht gebaut ist (wie früher pg_migrate). */
function ensureMigrateBuilt(): string {
  const main = join(repoRoot, "apps/migrate/dist/main.js");
  if (!existsSync(main) || !existsSync(join(repoRoot, "packages/kernel/dist/db/migrate.js"))) {
    const r = spawnSync("pnpm", ["-s", "--filter", "@shop/migrate...", "-r", "run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("Bauen des Dienstes migrate fehlgeschlagen");
  }
  return main;
}

function runNode(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [script], { cwd: repoRoot, env, stdio: "inherit" });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`Dienst migrate endete mit Code ${code ?? "?"}`)),
    );
  });
}

/**
 * Startet PostgreSQL 18.6 in einem Wegwerf-Container mit zufälligem Passwort.
 *
 * Testcontainers räumt normalerweise mit einem Hilfscontainer („Ryuk“) auf, der vollen Zugriff
 * auf Docker braucht. Den schalten wir ab (weniger fremder Code mit vollen Rechten) und räumen
 * selbst auf: stop() im finally, zusätzlich beim Beenden des Prozesses.
 */
export async function startTestDatabase(options: StartOptions = {}): Promise<TestDatabase> {
  process.env["TESTCONTAINERS_RYUK_DISABLED"] ??= "true";
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");

  const password = randomBytes(24).toString("hex");
  let builder = new PostgreSqlContainer(PG_IMAGE)
    .withUsername("postgres")
    .withPassword(password)
    .withDatabase("postgres")
    .withLabels({ "shop.test": "true" });
  const dirs = options.copyDirs ?? [];
  if (dirs.length > 0) {
    builder = builder.withCopyDirectoriesToContainer(
      dirs.map((d) => ({ source: join(repoRoot, d), target: `/repo/${d}`, mode: 0o755 })),
    );
  }
  const container: StartedPostgreSqlContainer = await builder.start();

  let stopped = false;
  const stopSync = (): void => {
    if (!stopped) spawnSync("docker", ["rm", "-f", container.getId()], { stdio: "ignore" });
  };
  process.once("exit", stopSync);

  const host = container.getHost();
  const port = container.getPort();
  const adminUrl = (database = "postgres"): string => {
    assertDbName(database);
    return `postgres://postgres:${password}@${host}:${port}/${database}`;
  };

  return {
    adminUrl,

    async psql(database, args, opts = {}) {
      assertDbName(database);
      const base = ["psql", "-X"];
      const env: Record<string, string> = { ...opts.env };
      if (opts.login) {
        base.push(`host=127.0.0.1 port=5432 dbname=${database} user=${opts.login.user}`);
        env["PGPASSWORD"] = opts.login.password;
      } else {
        base.push("-U", "postgres", "-d", database);
      }
      // Fehlerausgabe schon im Container auf die Ausgabe legen: Getrennt übertragen kämen
      // die Zeilen beider Ströme sonst gelegentlich zerstückelt und vermischt an.
      const merged = await container.exec(["sh", "-c", 'exec "$@" 2>&1', "psql", ...base, ...args], {
        user: "postgres",
        env,
      });
      return { exitCode: merged.exitCode, output: merged.stdout, stdout: merged.stdout };
    },

    async migrate(database) {
      assertDbName(database);
      const main = ensureMigrateBuilt();
      const url = adminUrl(database);
      await runNode(main, {
        ...process.env,
        SHOP_ENV: "test",
        SHOP_LOG_LEVEL: "warn",
        SHOP_MIGRATE_DATABASE_URL: url,
        SHOP_MIGRATE_CREATE_DATABASE: "true",
      });
      return url;
    },

    async stop() {
      if (stopped) return;
      await container.stop({ remove: true, removeVolumes: true });
      stopped = true;
      process.removeListener("exit", stopSync);
    },
  };
}
