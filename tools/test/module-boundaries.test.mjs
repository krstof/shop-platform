// Modulgrenzen (Architektur 3.3 und 3.4): module.json-Prüfung und dependency-cruiser-Regeln.
// Jede Regel wird mit Beispielmodulen in einem Wegwerf-Ordner gegengeprüft: erlaubte Importe
// bleiben grün, jeder eingeschleuste Verstoß wird gefunden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { cruise } from "dependency-cruiser";
import { loadModules, findCycle } from "../lib/modules.mjs";
import { buildRules, cruiseOptions } from "../lib/depcruise-rules.mjs";

/**
 * Legt einen Wegwerf-Ordner mit Dateien an.
 * @param {Record<string, string | object>} files
 */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "shop-modgrenzen-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

/** @param {string} name @param {string[]} dependsOn @param {string} [kind] */
const modJson = (name, dependsOn = [], kind = "module") => ({
  name,
  kind,
  schema: name.replace(/-/g, "_"),
  wave: "1",
  description: `Beispielmodul ${name} für den Test`,
  dependsOn,
});
/** @param {string} name */
const migration = (name) => `CREATE SCHEMA ${name.replace(/-/g, "_")};\n`;

/** Basis: kernel, Modul a darf b aufrufen, c ist unabhängig. */
function baseFiles() {
  return {
    "packages/kernel/module.json": modJson("kernel", [], "kernel"),
    "packages/kernel/migrations/1_k.sql": migration("kernel"),
    "packages/kernel/src/index.ts": "export const k = 1;\n",
    "modules/a/module.json": modJson("a", ["b"]),
    "modules/a/migrations/1_a.sql": migration("a"),
    "modules/a/src/index.ts": 'export { run } from "./internal/run.js";\n',
    "modules/a/src/internal/run.ts":
      'import { k } from "../../../../packages/kernel/src/index.js";\n' +
      'import { b } from "../../../b/src/index.js";\n' +
      "export const run = () => k + b;\n",
    "modules/b/module.json": modJson("b"),
    "modules/b/migrations/1_b.sql": migration("b"),
    "modules/b/src/index.ts": 'export { b } from "./internal/b.js";\n',
    "modules/b/src/internal/b.ts": "export const b = 2;\n",
    "modules/b/src/db.generated.ts": "export interface DB { x: number }\n",
    "modules/c/module.json": modJson("c"),
    "modules/c/migrations/1_c.sql": migration("c"),
    "modules/c/src/index.ts": "export const c = 3;\n",
    "apps/api/src/main.ts": 'import { run } from "../../../modules/a/src/index.js";\nrun();\n',
  };
}

/**
 * Lässt dependency-cruiser mit den aus module.json erzeugten Regeln laufen.
 * @param {string} dir
 * @returns {Promise<string[]>} Namen der verletzten Regeln (sortiert)
 */
async function violations(dir) {
  const mods = loadModules(dir);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const result = await cruise(["apps", "modules", "packages"], {
      ...cruiseOptions(),
      ruleSet: { forbidden: buildRules(mods) },
      validate: true,
    });
    const out = /** @type {import("dependency-cruiser").ICruiseResult} */ (result.output);
    return out.summary.violations.map((v) => v.rule.name).sort();
  } finally {
    process.chdir(prev);
  }
}

test("echte module.json im Projekt sind gültig und kreisfrei", () => {
  const mods = loadModules();
  assert.equal(mods.filter((m) => m.kind === "module").length, 21);
  assert.equal(mods.filter((m) => m.kind === "kernel").length, 1);
  assert.equal(new Set(mods.map((m) => m.schema)).size, mods.length, "jedes Schema gehört genau einem Modul");
});

test("erlaubte Importe sind grün (inkl. Auflösung von .js auf .ts)", async (t) => {
  const dir = fixture(baseFiles());
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(await violations(dir), []);
});

/** @type {Array<[string, Record<string,string>, string]>} */
const cases = [
  [
    "interne Datei eines erlaubten Moduls",
    {
      "modules/a/src/internal/peek.ts":
        'import { b } from "../../../b/src/internal/b.js";\nexport const p = b;\n',
    },
    "nur-oeffentliche-datei-fremder-module",
  ],
  [
    "Datenbanktypen eines fremden Moduls",
    {
      "modules/a/src/internal/peek.ts":
        'import type { DB } from "../../../b/src/db.generated.js";\nexport type P = DB;\n',
    },
    "nur-oeffentliche-datei-fremder-module",
  ],
  [
    "nicht erklärte Abhängigkeit (a → c)",
    {
      "modules/a/src/internal/peek.ts": 'import { c } from "../../../c/src/index.js";\nexport const p = c;\n',
    },
    "nicht-erklaerte-abhaengigkeit:a",
  ],
  [
    "Gegenrichtung (b → a) ohne Erklärung",
    {
      "modules/b/src/internal/back.ts":
        'import { run } from "../../../a/src/index.js";\nexport const p = run;\n',
    },
    "nicht-erklaerte-abhaengigkeit:b",
  ],
  [
    "Gegenrichtung, die einen Kreis über die Fassaden schließt",
    {
      "modules/b/src/index.ts":
        'export { b } from "./internal/b.js";\nexport { p } from "./internal/back.js";\n',
      "modules/b/src/internal/back.ts":
        'import { run } from "../../../a/src/index.js";\nexport const p = run;\n',
    },
    "kein-kreis,nicht-erklaerte-abhaengigkeit:b",
  ],
  [
    "Kreis innerhalb eines Moduls",
    {
      "modules/c/src/x.ts": 'import { y } from "./y.js";\nexport const x = () => y;\n',
      "modules/c/src/y.ts": 'import { x } from "./x.js";\nexport const y = () => x;\n',
    },
    "kein-kreis",
  ],
  [
    "Kernel importiert ein Fachmodul",
    {
      "packages/kernel/src/bad.ts":
        'import { c } from "../../../modules/c/src/index.js";\nexport const p = c;\n',
    },
    "kernel-kennt-keine-module,pakete-kennen-keine-module",
  ],
  [
    "Modul importiert aus einem Programm",
    { "modules/c/src/bad.ts": 'import "../../../apps/api/src/main.js";\n' },
    "module-kennen-keine-programme",
  ],
  [
    "Programm greift in das Innere eines Moduls",
    {
      "apps/api/src/bad.ts":
        'import { b } from "../../../modules/b/src/internal/b.js";\nexport const p = b;\n',
    },
    "programme-nur-ueber-oeffentliche-datei",
  ],
];

for (const [name, extra, expected] of cases) {
  test(`Verstoß wird gefunden: ${name}`, async (t) => {
    const dir = fixture({ ...baseFiles(), ...extra });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const found = [...new Set(await violations(dir))].join(",");
    assert.equal(found, expected);
  });
}

test("module.json: Kreis wird erkannt", () => {
  assert.deepEqual(
    findCycle([
      { name: "a", dependsOn: ["b"] },
      { name: "b", dependsOn: ["c"] },
      { name: "c", dependsOn: ["a"] },
    ]),
    ["a", "b", "c", "a"],
  );
  assert.equal(
    findCycle([
      { name: "a", dependsOn: ["b"] },
      { name: "b", dependsOn: [] },
    ]),
    null,
  );
});

/** @type {Array<[string, (f: Record<string, any>) => void, RegExp]>} */
const badJson = [
  [
    "Kreis über dependsOn",
    (f) => (f["modules/b/module.json"] = modJson("b", ["a"])),
    /Kreis in den Abhängigkeiten: a → b → a/,
  ],
  [
    "unbekanntes Modul",
    (f) => (f["modules/c/module.json"] = modJson("c", ["gibtsnicht"])),
    /unbekanntes Modul „gibtsnicht“/,
  ],
  [
    "Name passt nicht zum Ordner",
    (f) => (f["modules/c/module.json"] = modJson("x")),
    /passt nicht zum Ordner/,
  ],
  [
    "Schema nicht in eigener Migration",
    (f) => (f["modules/c/migrations/1_c.sql"] = "SELECT 1;\n"),
    /Schema „c“ wird in den eigenen Migrationen nicht angelegt/,
  ],
  [
    "Kernel mit Abhängigkeit",
    (f) => (f["packages/kernel/module.json"] = modJson("kernel", ["a"], "kernel")),
    /der Kernel darf von keinem Modul abhängen/,
  ],
  ["module.json fehlt", (f) => delete f["modules/c/module.json"], /modules\/c: module.json fehlt/],
  [
    "unbekanntes Feld",
    (f) => (f["modules/c/module.json"] = { ...modJson("c"), extra: 1 }),
    /unbekanntes Feld „extra“/,
  ],
  [
    "Schema doppelt vergeben",
    (f) => (f["modules/c/module.json"] = { ...modJson("c"), schema: "b" }),
    /Schema „b“ gehört zwei Modulen/,
  ],
];
for (const [name, mutate, expected] of badJson) {
  test(`module.json: ${name} wird abgelehnt`, (t) => {
    const files = /** @type {Record<string, any>} */ (baseFiles());
    mutate(files);
    if (name === "Schema doppelt vergeben") files["modules/c/migrations/1_c.sql"] = "CREATE SCHEMA b;\n";
    const dir = fixture(files);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.throws(() => loadModules(dir), expected);
  });
}

// Seit E4: Module sind pnpm-Pakete (@shop/<modul>). pnpm verlinkt sie unter node_modules.
// Die Regeln müssen auch über den Paketnamen greifen, ohne dass vorher gebaut wurde.

/** Wie baseFiles, zusätzlich ist Modul b als Paket @shop/b verlinkt (wie pnpm es tut). */
function packageFixture(/** @type {Record<string,string>} */ extra) {
  const dir = fixture({
    ...baseFiles(),
    "modules/b/package.json": {
      name: "@shop/b",
      type: "module",
      exports: { ".": { source: "./src/index.ts", types: "./dist/index.d.ts", default: "./dist/index.js" } },
    },
    ...extra,
  });
  mkdirSync(join(dir, "node_modules/@shop"), { recursive: true });
  symlinkSync("../../modules/b", join(dir, "node_modules/@shop/b"), "dir");
  return dir;
}

/** @type {Array<[string, Record<string,string>, string]>} */
const packageCases = [
  [
    "erlaubter Import über den Paketnamen",
    { "modules/a/src/internal/pkg.ts": 'import { b } from "@shop/b";\nexport const p = b;\n' },
    "",
  ],
  [
    "nicht erklärte Abhängigkeit über den Paketnamen (c → @shop/b)",
    { "modules/c/src/pkg.ts": 'import { b } from "@shop/b";\nexport const p = b;\n' },
    "nicht-erklaerte-abhaengigkeit:c",
  ],
  [
    "Griff ins Innere über den Paketnamen (@shop/b/src/internal/b.js)",
    {
      "modules/a/src/internal/pkg.ts":
        'import { b } from "@shop/b/src/internal/b.js";\nexport const p = b;\n',
    },
    "kein-unaufloesbarer-import",
  ],
  [
    "Kernel importiert ein Modul über den Paketnamen",
    { "packages/kernel/src/bad.ts": 'import { b } from "@shop/b";\nexport const p = b;\n' },
    "kernel-kennt-keine-module,pakete-kennen-keine-module",
  ],
];
for (const [name, extra, expected] of packageCases) {
  test(`Paketname: ${name}`, async (t) => {
    const dir = packageFixture(extra);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal([...new Set(await violations(dir))].join(","), expected);
  });
}

test("im echten Projekt löst @shop/catalog auf die öffentliche Quelldatei des Moduls auf", async () => {
  const result = await cruise(["apps/api/src/endpoints.ts"], { ...cruiseOptions(), validate: false });
  const out = /** @type {import("dependency-cruiser").ICruiseResult} */ (result.output);
  const deps = out.modules.find((m) => m.source === "apps/api/src/endpoints.ts")?.dependencies ?? [];
  const catalog = deps.find((d) => d.module === "@shop/catalog");
  assert.equal(catalog?.resolved, "modules/catalog/src/index.ts");
  assert.equal(catalog?.couldNotResolve, false);
});
