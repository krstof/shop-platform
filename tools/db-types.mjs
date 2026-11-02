// Erzeugt oder prüft src/db.generated.ts je Modul mit kysely-codegen (Architektur 3.4).
// Wird von pnpm db:types (tools/testdb.mjs, @shop/testing) mit einer frisch migrierten
// Wegwerf-Datenbank in SHOP_CODEGEN_URL aufgerufen.
// Aufruf: node tools/db-types.mjs write|--check
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadModules, repoRoot } from "./lib/modules.mjs";

const mode = process.argv[2] === "--check" ? "check" : "write";
if (!process.env["SHOP_CODEGEN_URL"]) {
  console.error("SHOP_CODEGEN_URL fehlt. Bitte über „pnpm db:types“ aufrufen.");
  process.exit(2);
}
const bin = join(repoRoot, "node_modules/.bin/kysely-codegen");

/** @type {string[]} */
const failed = [];
for (const m of loadModules()) {
  const rel = `${m.dir}/src/db.generated.ts`;
  const out = join(repoRoot, rel);
  const args = [
    "--dialect",
    "postgres",
    "--url",
    "env(SHOP_CODEGEN_URL)",
    "--include-pattern",
    `${m.schema}.*`,
    "--out-file",
    out,
    "--log-level",
    "error",
  ];
  if (mode === "check") {
    if (!existsSync(out)) {
      failed.push(`${rel} fehlt`);
      continue;
    }
    args.push("--verify");
  }
  const r = spawnSync(bin, args, { cwd: repoRoot, encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    failed.push(`${rel}: ${mode === "check" ? "nicht aktuell" : "Erzeugung fehlgeschlagen"}`);
    process.stderr.write(r.stdout + r.stderr);
    continue;
  }
  // Gegenprobe: Der Typ DB darf nur Tabellen des eigenen Schemas enthalten.
  const src = readFileSync(out, "utf8");
  const body = src.slice(src.indexOf("export interface DB {"));
  const keys = [...body.matchAll(/^\s+"?([a-z_]+)\.[^:]+:/gm)].map((x) => x[1]);
  if (keys.length === 0) failed.push(`${rel}: enthält keine einzige Tabelle`);
  const foreign = keys.filter((s) => s !== m.schema);
  if (foreign.length > 0) failed.push(`${rel}: enthält fremde Schemas (${[...new Set(foreign)].join(", ")})`);
  console.log(
    `${mode === "check" ? "OK   aktuell" : "OK   erzeugt"}: ${rel} (${keys.length} Tabellen aus ${m.schema})`,
  );
}
if (failed.length > 0) {
  console.error(`\n✖ Datenbanktypen:\n  - ${failed.join("\n  - ")}`);
  if (mode === "check") console.error("Abhilfe: pnpm db:types ausführen und die Dateien committen.");
  process.exit(1);
}
