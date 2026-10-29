// Gegenprobe zu T-06: gitleaks muss eingeschleuste Geheimnisse wirklich finden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gitleaks = execFileSync("bash", [join(root, "tools/ensure-tool.sh"), "gitleaks"], {
  encoding: "utf8",
}).trim();

/** @param {Record<string,string>} files */
function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), "shop-leak-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const r = spawnSync(
    gitleaks,
    [
      "dir",
      "--config",
      join(root, ".gitleaks.toml"),
      "--no-banner",
      "--redact",
      "--exit-code",
      "1",
      "--report-format",
      "json",
      "--report-path",
      "-",
      dir,
    ],
    { encoding: "utf8" },
  );
  return { found: r.status === 1, report: r.stdout };
}

test("findet ein API-Token der Plattform (shp_at_)", () => {
  const r = scan({ "config.ts": `const token = "shp_at_${randomBytes(32).toString("base64url")}";\n` });
  assert.equal(r.found, true);
  assert.match(r.report, /shop-api-token/);
});

test("findet ein Passwort aus einer kopierten .env", () => {
  const r = scan({ "notes.txt": `POSTGRES_SUPERUSER_PASSWORD=${randomBytes(36).toString("base64url")}\n` });
  assert.equal(r.found, true);
});

test("findet einen privaten Schlüssel", () => {
  const key = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
  const r = scan({
    id_rsa: `${key}\n${randomBytes(600).toString("base64")}\n-----END RSA PRIVATE KEY-----\n`,
  });
  assert.equal(r.found, true);
});

test("meldet keine Platzhalter aus der Vorlage", () => {
  const r = scan({ "example.txt": "POSTGRES_SUPERUSER_PASSWORD=__SECRET__\nGARAGE_RPC_SECRET=__HEX32__\n" });
  assert.equal(r.found, false);
});
