// Führt alle Prüfungen aus, die vor jedem Commit grün sein müssen (Architektur 8.2).
// In der CI laufen dieselben Schritte als einzelne Jobs.
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Array<[string, string[]]>} */
const steps = [
  ["Formatierung (Prettier)", ["pnpm", "-s", "format:check"]],
  ["Lint (ESLint)", ["pnpm", "-s", "lint"]],
  ["Modulgrenzen (dependency-cruiser, module.json)", ["pnpm", "-s", "lint:deps"]],
  ["Typprüfung (TypeScript)", ["pnpm", "-s", "typecheck"]],
  ["Bauen der Pakete", ["pnpm", "-s", "build"]],
  ["OpenAPI aktuell, jede Operation mit Berechtigung (API-03, T-09)", ["pnpm", "-s", "openapi", "--check"]],
  ["Tests der Werkzeuge", ["pnpm", "-s", "test:tools"]],
  ["Geheimnisse (gitleaks, T-06)", ["pnpm", "-s", "scan:secrets"]],
  ["Abhängigkeiten (OSV-Scanner, pnpm audit, T-07)", ["pnpm", "-s", "scan:deps"]],
];
const docker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
if (docker) {
  steps.push(["Bruchprüfung der API gegen origin/main (oasdiff)", ["bash", "tools/oasdiff.sh"]]);
  steps.push(["Datenbank: Isolation und Rechte (T-01 bis T-05)", ["pnpm", "-s", "test:db"]]);
  steps.push(["Datenbanktypen je Modul aktuell (kysely-codegen)", ["pnpm", "-s", "db:types", "--check"]]);
  steps.push(["Tests der Pakete mit Datenbank (u. a. T-08, T-19)", ["pnpm", "-s", "test:with-db"]]);
  if (process.env["SHOP_SCHEMATHESIS"] !== undefined)
    steps.push(["Zufallstests der API (Schemathesis, T-12)", ["pnpm", "-s", "test:fuzz"]]);
  else console.log("ℹ SHOP_SCHEMATHESIS nicht gesetzt: Schemathesis (T-12) läuft nur in der CI.");
} else {
  steps.push(["Tests der Pakete ohne Datenbank (u. a. T-19)", ["pnpm", "-s", "test"]]);
}

/** @type {string[]} */
const failed = [];
for (const [name, [cmd, ...args]] of steps) {
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd ?? "", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) failed.push(name);
}
if (!docker) console.log("\n⚠ Docker nicht erreichbar: Datenbanktests übersprungen (laufen in der CI).");
console.log(
  failed.length === 0 ? "\n✔ Alle Prüfungen bestanden." : `\n✖ Fehlgeschlagen: ${failed.join(", ")}`,
);
process.exit(failed.length === 0 ? 0 : 1);
