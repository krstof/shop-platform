// pnpm openapi          schreibt openapi/admin.json, openapi/store.json, openapi/platform.json
// pnpm openapi --check  prüft nur: Dateien aktuell und jede Operation mit Berechtigung (CI)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allEndpoints, unconnectedDatabase } from "./endpoints.js";
import { buildAllOpenApi, lintOpenApi } from "./openapi.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function runOpenApiCli(args: readonly string[], root = repoRoot): number {
  const check = args.includes("--check");
  const docs = buildAllOpenApi(allEndpoints({ database: unconnectedDatabase }));
  const outDir = join(root, "openapi");
  const problems: string[] = [];
  for (const [api, doc] of Object.entries(docs)) {
    for (const p of lintOpenApi(doc)) problems.push(`${api}: ${p}`);
    const file = join(outDir, `${api}.json`);
    const text = JSON.stringify(doc, null, 2) + "\n";
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== text)
        problems.push(`openapi/${api}.json ist veraltet. Bitte „pnpm openapi“ ausführen und einchecken.`);
    } else {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(file, text);
      console.log(`✔ openapi/${api}.json geschrieben`);
    }
  }
  for (const p of problems) console.error(`✖ ${p}`);
  if (check && problems.length === 0)
    console.log("✔ OpenAPI-Dateien aktuell, jede Operation erklärt ihre Berechtigung.");
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runOpenApiCli(process.argv.slice(2));
}
