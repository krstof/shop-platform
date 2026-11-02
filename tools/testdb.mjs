// Startet shop-testdb aus @shop/testing (Wegwerf-Datenbank per Testcontainers, Architektur 8.1)
// und baut das Paket vorher, falls nötig. Aufruf über pnpm test:with-db und pnpm db:types.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./lib/modules.mjs";

const cli = join(repoRoot, "packages/testing/dist/cli.js");
if (!existsSync(cli)) {
  const r = spawnSync("pnpm", ["-s", "--filter", "@shop/testing", "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
await import(pathToFileURL(cli).href);
