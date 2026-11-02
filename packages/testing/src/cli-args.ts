// Zerlegt die Befehlszeile von shop-testdb (eigene Datei, damit sie ohne Docker testbar ist).

export type CliCommand =
  | { kind: "run"; command: string[] }
  | { kind: "migrated"; database: string; envVar: string; command: string[] };

const ENV_VAR = /^[A-Z][A-Z0-9_]*$/;

export const USAGE = `Aufruf:
  shop-testdb run -- <befehl …>
      Startet eine leere Wegwerf-Datenbank, setzt SHOP_TEST_DATABASE_URL (Superuser) und
      SHOP_REQUIRE_DB_TESTS=true und führt den Befehl aus.
  shop-testdb migrated <datenbank> <VARIABLE> -- <befehl …>
      Wie run, legt aber zusätzlich <datenbank> an, migriert sie mit dem Dienst migrate und
      gibt ihre Adresse in <VARIABLE> an den Befehl weiter.`;

export function parseArgs(argv: string[]): CliCommand {
  const sep = argv.indexOf("--");
  const head = sep === -1 ? argv : argv.slice(0, sep);
  const command = sep === -1 ? [] : argv.slice(sep + 1);
  if (command.length === 0) throw new Error("Es fehlt der Befehl nach „--“.");
  const [kind, ...rest] = head;
  if (kind === "run" && rest.length === 0) return { kind, command };
  if (kind === "migrated" && rest.length === 2) {
    const [database = "", envVar = ""] = rest;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error(`Ungültiger Datenbankname: ${database}`);
    if (!ENV_VAR.test(envVar)) throw new Error(`Ungültiger Variablenname: ${envVar}`);
    return { kind, database, envVar, command };
  }
  throw new Error("Unbekannter Aufruf.");
}
