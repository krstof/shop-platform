// Liest db/global-tables.yaml, prüft den Aufbau und gibt die Listen für den Isolationstest aus.
// Aufruf: node tools/global-tables.mjs schemas|tables  → kommagetrennte Liste auf stdout
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { repoRoot } from "./lib/modules.mjs";

const SCHEMA = /^[a-z][a-z0-9_]*$/;
const TABLE = /^[a-z][a-z0-9_]*\.("[a-z][a-z0-9_]*"|[a-z][a-z0-9_]*)$/;

/**
 * @param {string} [file]
 * @returns {{ schemas: string[], tables: string[] }}
 */
export function loadGlobalTables(file = join(repoRoot, "db/global-tables.yaml")) {
  /** @type {any} */
  const doc = parse(readFileSync(file, "utf8"));
  /** @type {string[]} */
  const errors = [];
  /** @param {string} key @param {RegExp} re */
  const list = (key, re) => {
    const items = doc?.[key];
    if (!Array.isArray(items)) {
      errors.push(`„${key}“ muss eine Liste sein`);
      return [];
    }
    /** @type {string[]} */
    const names = [];
    for (const [i, it] of items.entries()) {
      const where = `${key}[${i}]`;
      if (typeof it?.name !== "string" || !re.test(it.name))
        errors.push(`${where}: name fehlt oder hat falsches Format`);
      else names.push(it.name);
      if (typeof it?.reason !== "string" || it.reason.trim().length < 20)
        errors.push(`${where}: Begründung (reason) fehlt oder ist zu kurz`);
      for (const k of Object.keys(it ?? {}))
        if (k !== "name" && k !== "reason") errors.push(`${where}: unbekanntes Feld „${k}“`);
    }
    const dup = names.filter((n, j) => names.indexOf(n) !== j);
    if (dup.length > 0) errors.push(`${key}: doppelt eingetragen: ${dup.join(", ")}`);
    return names;
  };
  const schemas = list("schemas", SCHEMA);
  const tables = list("tables", TABLE);
  for (const t of tables) {
    if (schemas.includes(t.split(".")[0] ?? ""))
      errors.push(`${t}: steht schon über sein Schema auf der Liste`);
  }
  if (errors.length > 0) throw new Error(`db/global-tables.yaml ungültig:\n  - ${errors.join("\n  - ")}`);
  return { schemas, tables };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const what = process.argv[2];
  const g = loadGlobalTables();
  if (what === "schemas") process.stdout.write(g.schemas.join(","));
  else if (what === "tables") process.stdout.write(g.tables.join(","));
  else {
    console.error("Aufruf: node tools/global-tables.mjs schemas|tables");
    process.exit(2);
  }
}
