// Liest und prüft alle module.json-Dateien (Architektur 3.3 und 3.4, ADR-002).
// Grundlage für die Importregeln (dependency-cruiser) und die Datenbanktypen je Modul.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * @typedef {object} ModuleInfo
 * @property {string} name        Name, gleich dem Ordnernamen (kebab-case)
 * @property {"module"|"kernel"} kind
 * @property {string} schema      Eigenes Datenbankschema
 * @property {string} wave
 * @property {string} description
 * @property {string[]} dependsOn Module, deren Fassade aufgerufen werden darf
 * @property {string} dir         Ordner relativ zur Wurzel, z. B. "modules/catalog"
 */

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SCHEMA = /^[a-z][a-z0-9_]*$/;
const KEYS = ["$schema", "name", "kind", "schema", "wave", "description", "dependsOn"];

/**
 * Lädt alle Module unter `modules/` plus den Kernel und prüft sie.
 * Wirft einen Fehler mit allen Befunden, wenn etwas nicht stimmt.
 * @param {string} [root]
 * @returns {ModuleInfo[]}
 */
export function loadModules(root = repoRoot) {
  /** @type {string[]} */
  const dirs = [];
  if (existsSync(join(root, "packages/kernel/module.json"))) dirs.push("packages/kernel");
  const modulesDir = join(root, "modules");
  if (existsSync(modulesDir)) {
    for (const e of readdirSync(modulesDir, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(`modules/${e.name}`);
    }
  }
  /** @type {string[]} */
  const errors = [];
  /** @type {ModuleInfo[]} */
  const mods = [];
  for (const dir of dirs.sort()) {
    const file = join(root, dir, "module.json");
    if (!existsSync(file)) {
      errors.push(`${dir}: module.json fehlt`);
      continue;
    }
    /** @type {any} */
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      errors.push(`${dir}/module.json: kein gültiges JSON (${/** @type {Error} */ (e).message})`);
      continue;
    }
    const folder = dir.split("/").pop() ?? "";
    for (const k of Object.keys(raw)) if (!KEYS.includes(k)) errors.push(`${dir}: unbekanntes Feld „${k}“`);
    if (typeof raw.name !== "string" || !NAME.test(raw.name))
      errors.push(`${dir}: name fehlt oder ist kein kebab-case`);
    else if (raw.name !== folder)
      errors.push(`${dir}: name „${raw.name}“ passt nicht zum Ordner „${folder}“`);
    const kind = dir === "packages/kernel" ? "kernel" : "module";
    if (raw.kind !== kind) errors.push(`${dir}: kind muss „${kind}“ sein`);
    if (typeof raw.schema !== "string" || !SCHEMA.test(raw.schema))
      errors.push(`${dir}: schema fehlt oder ist ungültig`);
    if (typeof raw.wave !== "string" || raw.wave === "") errors.push(`${dir}: wave fehlt`);
    if (typeof raw.description !== "string" || raw.description.length < 10)
      errors.push(`${dir}: description fehlt`);
    if (
      !Array.isArray(raw.dependsOn) ||
      raw.dependsOn.some((/** @type {unknown} */ d) => typeof d !== "string")
    ) {
      errors.push(`${dir}: dependsOn muss eine Liste von Modulnamen sein`);
      continue;
    }
    if (kind === "kernel" && raw.dependsOn.length > 0)
      errors.push(`${dir}: der Kernel darf von keinem Modul abhängen`);
    if (new Set(raw.dependsOn).size !== raw.dependsOn.length)
      errors.push(`${dir}: dependsOn enthält Doppelte`);
    if (raw.dependsOn.includes(raw.name)) errors.push(`${dir}: ein Modul hängt nicht von sich selbst ab`);
    // Das Schema muss in den eigenen Migrationen angelegt werden.
    const migDir = join(root, dir, "migrations");
    const sql = existsSync(migDir)
      ? readdirSync(migDir)
          .filter((f) => f.endsWith(".sql"))
          .map((f) => readFileSync(join(migDir, f), "utf8"))
          .join("\n")
      : "";
    if (typeof raw.schema === "string" && !new RegExp(`CREATE SCHEMA ${raw.schema}\\b`).test(sql)) {
      errors.push(`${dir}: Schema „${raw.schema}“ wird in den eigenen Migrationen nicht angelegt`);
    }
    mods.push({ ...raw, kind, dir });
  }

  const names = new Set(mods.map((m) => m.name));
  const schemas = new Map();
  for (const m of mods) {
    if (schemas.has(m.schema))
      errors.push(`Schema „${m.schema}“ gehört zwei Modulen: ${schemas.get(m.schema)} und ${m.name}`);
    schemas.set(m.schema, m.name);
    for (const d of m.dependsOn) {
      if (d === "kernel") errors.push(`${m.dir}: kernel nicht in dependsOn eintragen, er ist immer erlaubt`);
      else if (!names.has(d)) errors.push(`${m.dir}: dependsOn nennt unbekanntes Modul „${d}“`);
    }
  }
  const cycle = findCycle(mods);
  if (cycle) errors.push(`Kreis in den Abhängigkeiten: ${cycle.join(" → ")}`);

  if (errors.length > 0) throw new Error(`module.json ungültig:\n  - ${errors.join("\n  - ")}`);
  return mods;
}

/**
 * Sucht einen Kreis im Abhängigkeitsgraphen (Tiefensuche).
 * @param {Pick<ModuleInfo, "name"|"dependsOn">[]} mods
 * @returns {string[] | null} der Kreis als Namensliste (erstes = letztes Element) oder null
 */
export function findCycle(mods) {
  const deps = new Map(mods.map((m) => [m.name, m.dependsOn]));
  /** @type {Map<string, 1|2>} 1 = in Arbeit, 2 = fertig */
  const state = new Map();
  /** @type {string[]} */
  const stack = [];
  /** @param {string} n @returns {string[] | null} */
  const visit = (n) => {
    if (state.get(n) === 2) return null;
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 1);
    stack.push(n);
    for (const d of deps.get(n) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const m of [...deps.keys()].sort()) {
    const c = visit(m);
    if (c) return c;
  }
  return null;
}
