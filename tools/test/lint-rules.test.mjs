// Eigene ESLint-Regeln (Architektur 3.4, Sicherheit 5.4) mit Gegenproben: Verbotenes wird
// gemeldet, Erlaubtes nicht. Geprüft wird die echte Projekteinstellung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { repoRoot } from "../lib/modules.mjs";

const eslint = new ESLint({ cwd: repoRoot });

/** @param {string} code @param {string} filePath */
async function ruleIds(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return [...new Set((result?.messages ?? []).map((m) => m.ruleId))].sort();
}

/** @type {Array<[string, string, string, string[]]>} */
const cases = [
  [
    "rohes SQL per sql-Vorlage im Modul",
    "modules/catalog/src/bad.ts",
    'import { sql } from "kysely";\nexport const q = sql`select 1`;\n',
    ["no-restricted-imports"],
  ],
  [
    "CompiledQuery im Modul",
    "modules/orders/src/bad.ts",
    'import { CompiledQuery } from "kysely";\nexport const q = CompiledQuery.raw("select 1");\n',
    ["no-restricted-imports"],
  ],
  [
    "Namensraum-Import von kysely im Modul",
    "modules/cart/src/bad.ts",
    'import * as k from "kysely";\nexport const q = k.sql`select 1`;\n',
    ["no-restricted-imports", "no-restricted-syntax"],
  ],
  [
    "dynamischer Import von kysely im Modul",
    "modules/cart/src/bad.ts",
    'export const k = await import("kysely");\n',
    ["no-restricted-syntax"],
  ],
  [
    "Datenbanktreiber im Modul",
    "modules/catalog/src/bad.ts",
    'import pg from "pg";\nexport const p = pg;\n',
    ["no-restricted-imports"],
  ],
  [
    "rohes SQL auch im Modul identity",
    "modules/identity/src/bad.ts",
    'import { sql } from "kysely";\nexport const q = sql`select 1`;\n',
    ["no-restricted-imports"],
  ],
  [
    "Datenbanktreiber im Programm api",
    "apps/api/src/bad.ts",
    'import pg from "pg";\nexport const p = pg;\n',
    ["no-restricted-imports"],
  ],
  [
    "Typen aus kysely im Modul sind erlaubt",
    "modules/catalog/src/ok.ts",
    'import type { Selectable } from "kysely";\nexport type T = Selectable<{ a: number }>;\n',
    [],
  ],
  [
    "rohes SQL im Kernel ist erlaubt",
    "packages/kernel/src/ok.ts",
    'import { sql } from "kysely";\nexport const q = sql`select 1`;\n',
    [],
  ],
  [
    "Treiber im Datenbanktest der API ist erlaubt",
    "apps/api/src/x.db.test.ts",
    'import pg from "pg";\nexport const p = pg;\n',
    [],
  ],
];

for (const [name, file, code, expected] of cases) {
  test(`ESLint: ${name}`, async () => {
    assert.deepEqual(await ruleIds(code, file), expected);
  });
}
