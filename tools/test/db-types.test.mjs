// Datenbanktypen je Modul (Architektur 3.4): Eine Abfrage auf die eigene Tabelle lässt sich
// übersetzen, eine Abfrage auf die Tabelle eines fremden Moduls nicht. Geprüft mit dem echten
// TypeScript-Compiler und den eingecheckten db.generated.ts-Dateien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadModules, repoRoot } from "../lib/modules.mjs";

// Innerhalb des Projekts, damit „kysely“ aus node_modules gefunden wird.
const dir = join(repoRoot, "node_modules/.cache/shop-db-types-test");

/** @param {string} code @returns {{ ok: boolean, out: string }} */
function compile(code) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "probe.mts");
  writeFileSync(file, code);
  const r = spawnSync(
    join(repoRoot, "node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--types",
      "node",
      "--skipLibCheck",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--target",
      "es2024",
      file,
    ],
    { encoding: "utf8" },
  );
  const out = r.stdout + r.stderr;
  // Fehler der Compiler-Einstellungen (TS5xxx) dürfen eine Gegenprobe nie „grün“ machen.
  assert.doesNotMatch(out, /error TS5\d{3}/, out);
  return { ok: r.status === 0, out };
}

/** @param {string} mod */
const header = (mod) =>
  `import type { Kysely } from "kysely";\n` +
  `import type { DB } from ${JSON.stringify(join(repoRoot, mod, "src/db.generated.js"))};\n` +
  `declare const db: Kysely<DB>;\n`;

test("jedes Modul hat eine db.generated.ts nur mit Tabellen des eigenen Schemas", () => {
  let total = 0;
  for (const m of loadModules()) {
    const src = readFileSync(join(repoRoot, m.dir, "src/db.generated.ts"), "utf8");
    const keys = [
      ...src.slice(src.indexOf("export interface DB {")).matchAll(/^\s+"([a-z_]+)\.[^"]+":/gm),
    ].map((x) => x[1]);
    assert.ok(keys.length > 0, `${m.name}: keine Tabellen`);
    assert.deepEqual([...new Set(keys)], [m.schema], `${m.name}: nur Schema ${m.schema}`);
    total += keys.length;
  }
  assert.equal(total, 117, "alle 117 Tabellen sind genau einem Modul zugeordnet");
});

test("Abfrage auf eigene Tabelle lässt sich übersetzen", () => {
  const r = compile(
    header("modules/cart") +
      `export const q = db.selectFrom("cart.cart_line").select(["id", "quantity"]).where("tenant_id", "=", "x");\n`,
  );
  assert.ok(r.ok, r.out);
});

test("Gegenprobe: Abfrage auf Tabelle eines fremden Moduls lässt sich nicht übersetzen", () => {
  const r = compile(
    header("modules/cart") + `export const q = db.selectFrom("catalog.product").selectAll();\n`,
  );
  assert.equal(r.ok, false, "fremde Tabelle darf nicht übersetzbar sein");
  assert.match(r.out, /catalog\.product/);
});

test("Gegenprobe: Spalte, die es nicht gibt, lässt sich nicht übersetzen", () => {
  const r = compile(
    header("modules/cart") + `export const q = db.selectFrom("cart.cart").select("password_hash");\n`,
  );
  assert.equal(r.ok, false);
  assert.match(r.out, /password_hash/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
