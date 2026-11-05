// Die Migration der Warteschlange muss genau zum installierten pg-boss passen (Etappe E5).
// Schlägt der Test nach einem Update von pg-boss an: Die alte Migration bleibt unverändert,
// das Update braucht eine NEUE Migration mit getMigrationPlans (siehe scripts/pgboss-schema.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error Skript ohne Typen (JavaScript-Modul für die Befehlszeile)
import * as script from "../../scripts/pgboss-schema.mjs";
import { expectedJobSchemaVersion } from "./queue.js";

const { PGBOSS_MIGRATION_PATH, pgbossSchemaSql, pgbossSchemaVersion } = script as {
  PGBOSS_MIGRATION_PATH: string;
  pgbossSchemaSql: () => string;
  pgbossSchemaVersion: (sql?: string) => number;
};

describe("Migration der Warteschlange pg-boss", () => {
  const file = readFileSync(PGBOSS_MIGRATION_PATH, "utf8");

  it("entspricht Zeichen für Zeichen dem SQL der installierten pg-boss-Version", () => {
    expect(file).toBe(pgbossSchemaSql());
  });

  it("trägt die Schema-Version ein, die pg-boss beim Start erwartet", () => {
    expect(pgbossSchemaVersion(file)).toBe(expectedJobSchemaVersion());
  });

  it("enthält keine eigene Transaktion, keine Sperre und kein SET", () => {
    expect(file).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
    expect(file).not.toMatch(/pg_advisory_xact_lock/);
    expect(file).not.toMatch(/^\s*SET\s/im);
  });
});
