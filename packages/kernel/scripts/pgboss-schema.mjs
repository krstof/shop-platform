// Erzeugt die Migration für die Warteschlange pg-boss (Etappe E5, ADR-007).
//
// pg-boss legt seine Tabellen normalerweise beim Start selbst an. Das wollen wir nicht: Die
// Anwendung darf die Struktur der Datenbank nie ändern (Sicherheit 5.4). Deshalb steht das SQL
// von pg-boss als gewöhnliche Migration im Kernel und läuft wie alle anderen als shop_owner.
// pg-boss hüllt sein SQL in eine eigene Transaktion mit Sperre; beides übernimmt bei uns der
// Migrationslauf, deshalb wird die Hülle hier entfernt.
//
// Aufruf (schreibt die Datei neu, nur bei einem Update von pg-boss nötig):
//   node packages/kernel/scripts/pgboss-schema.mjs
// Der Test src/jobs/pgboss-schema.test.ts prüft, dass die Datei zur installierten Version passt.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConstructionPlans } from "pg-boss";

export const PGBOSS_SCHEMA = "pgboss";
export const PGBOSS_MIGRATION = "20261105T060000_create_pgboss.sql";

const HEADER = `-- =============================================================================
-- Warteschlange pg-boss (Etappe E5, ADR-007): Tabellen, Typen und Funktionen
-- ERZEUGT mit packages/kernel/scripts/pgboss-schema.mjs aus pg-boss selbst, nie von Hand ändern.
-- Die eigene Transaktion und Sperre von pg-boss sind entfernt, beides macht der Migrationslauf.
-- Rechte stehen in der nächsten Migration (20261105T060100_pgboss_rights.sql).
-- =============================================================================
`;

/** SQL von pg-boss ohne die eigene Transaktions-Hülle. Wirft, wenn sich die Hülle geändert hat. */
export function pgbossSchemaSql() {
  const plan = getConstructionPlans(PGBOSS_SCHEMA, { createSchema: true });
  const head =
    /^\s*BEGIN;\s*\n\s*SET LOCAL lock_timeout = \d+;\s*\n\s*SET LOCAL idle_in_transaction_session_timeout = \d+;\s*\n\s*SELECT pg_advisory_xact_lock\([^\n]*\);\s*\n/;
  const tail = /\n\s*COMMIT;\s*$/;
  if (!head.test(plan) || !tail.test(plan)) {
    throw new Error("pg-boss hat das Format seines SQL geändert: Hülle nicht erkannt, Skript anpassen");
  }
  const body = plan.replace(head, "").replace(tail, "\n");
  return `${HEADER}\n${body.trimEnd()}\n`;
}

/** Version des Schemas, die das SQL einträgt (Zeile INSERT INTO pgboss.version). */
export function pgbossSchemaVersion(sql = pgbossSchemaSql()) {
  const m = /INSERT INTO pgboss\.version\(version\) VALUES \('(\d+)'\)/.exec(sql);
  if (m === null) throw new Error("Version im SQL von pg-boss nicht gefunden");
  return Number(m[1]);
}

const here = dirname(fileURLToPath(import.meta.url));
export const PGBOSS_MIGRATION_PATH = join(here, "..", "migrations", PGBOSS_MIGRATION);

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(PGBOSS_MIGRATION_PATH, pgbossSchemaSql());
  console.log(`geschrieben: ${PGBOSS_MIGRATION} (pg-boss Schema-Version ${pgbossSchemaVersion()})`);
}
