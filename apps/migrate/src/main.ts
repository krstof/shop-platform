// Dienst `migrate` (Architektur 7.1): richtet Rollen ein, setzt deren Passwörter aus den
// Einstellungen, führt alle neuen Migrationen aus und beendet sich. Exit-Code 0 bei Erfolg,
// 1 bei Fehler. Wird von `pnpm dev`, später vom Container beim Start und in Tests benutzt.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createLogger, flag, loadConfig, postgresUrl, secret, SHOP_ENVS } from "@shop/kernel";
import { ensureDatabase, runMigrations, type LoginRole } from "@shop/kernel/migrate";

export const migrateConfigSchema = z.object({
  SHOP_ENV: z.enum(SHOP_ENVS),
  SHOP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Verwaltungsrolle, darf Rollen anlegen. Nur dieser Dienst kennt sie. */
  SHOP_MIGRATE_DATABASE_URL: postgresUrl(),
  /** Ordner mit `db/` und den Migrationen. Standard: das Repository, in dem dieser Dienst liegt. */
  SHOP_MIGRATIONS_ROOT: z.string().optional(),
  /** Datenbank anlegen, falls sie fehlt. Nur für die lokale Entwicklung gedacht. */
  SHOP_MIGRATE_CREATE_DATABASE: flag().default(false),
  SHOP_DB_PASSWORD_APP: secret().optional(),
  SHOP_DB_PASSWORD_PLATFORM: secret().optional(),
  SHOP_DB_PASSWORD_AUTH: secret().optional(),
  SHOP_DB_PASSWORD_RELAY: secret().optional(),
  SHOP_DB_PASSWORD_BACKUP: secret().optional(),
});
export type MigrateConfig = z.infer<typeof migrateConfigSchema>;

export function rolePasswordsFrom(config: MigrateConfig): Partial<Record<LoginRole, string>> {
  const map: [LoginRole, string | undefined][] = [
    ["shop_app", config.SHOP_DB_PASSWORD_APP],
    ["shop_platform", config.SHOP_DB_PASSWORD_PLATFORM],
    ["shop_auth", config.SHOP_DB_PASSWORD_AUTH],
    ["shop_relay", config.SHOP_DB_PASSWORD_RELAY],
    ["shop_backup", config.SHOP_DB_PASSWORD_BACKUP],
  ];
  return Object.fromEntries(map.filter((entry): entry is [LoginRole, string] => entry[1] !== undefined));
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let config: MigrateConfig;
  try {
    config = loadConfig(migrateConfigSchema, env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const logger = createLogger({ level: config.SHOP_LOG_LEVEL, name: "migrate" });
  const rootDir = config.SHOP_MIGRATIONS_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  try {
    if (config.SHOP_MIGRATE_CREATE_DATABASE && (await ensureDatabase(config.SHOP_MIGRATE_DATABASE_URL))) {
      logger.info("Datenbank angelegt");
    }
    const result = await runMigrations({
      connectionString: config.SHOP_MIGRATE_DATABASE_URL,
      rootDir,
      rolePasswords: rolePasswordsFrom(config),
      log: (msg, details) => logger.info(details ?? {}, msg),
    });
    logger.info(
      { applied: result.applied.length, alreadyApplied: result.alreadyApplied },
      result.applied.length === 0 ? "Datenbank ist aktuell" : "Migrationen abgeschlossen",
    );
    return 0;
  } catch (error) {
    logger.error({ err: error }, "Migrationslauf gescheitert");
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
