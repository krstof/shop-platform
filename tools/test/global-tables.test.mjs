// db/global-tables.yaml: Aufbau wird geprüft, jeder Eintrag braucht eine Begründung.
// Ob die Liste zur Datenbank passt, prüft der Isolationstest (db/test_isolation.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGlobalTables } from "../global-tables.mjs";

test("echte Liste ist gültig", () => {
  const g = loadGlobalTables();
  assert.deepEqual(g.schemas, ["platform", "shop_migration"]);
  assert.ok(g.tables.includes('identity."user"'));
  assert.ok(g.tables.includes("tax.tax_rate"));
});

/** @type {Array<[string, string, RegExp]>} */
const bad = [
  ["Begründung fehlt", "schemas: []\ntables:\n  - name: a.b\n", /Begründung \(reason\) fehlt/],
  ["Begründung zu kurz", "schemas: []\ntables:\n  - name: a.b\n    reason: weil\n", /zu kurz/],
  [
    "Tabelle ohne Schema",
    "schemas: []\ntables:\n  - name: tabelle\n    reason: eine ausreichend lange Begründung\n",
    /falsches Format/,
  ],
  [
    "doppelter Eintrag",
    "schemas: []\ntables:\n  - name: a.b\n    reason: eine ausreichend lange Begründung\n  - name: a.b\n    reason: eine ausreichend lange Begründung\n",
    /doppelt eingetragen: a\.b/,
  ],
  [
    "Tabelle in globalem Schema",
    "schemas:\n  - name: a\n    reason: eine ausreichend lange Begründung\ntables:\n  - name: a.b\n    reason: eine ausreichend lange Begründung\n",
    /steht schon über sein Schema/,
  ],
  ["Liste fehlt", "schemas: []\n", /„tables“ muss eine Liste sein/],
  [
    "unbekanntes Feld",
    "schemas: []\ntables:\n  - name: a.b\n    reason: eine ausreichend lange Begründung\n    rls: false\n",
    /unbekanntes Feld „rls“/,
  ],
];
for (const [name, yaml, expected] of bad) {
  test(`abgelehnt: ${name}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "shop-global-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "g.yaml");
    writeFileSync(file, yaml);
    assert.throws(() => loadGlobalTables(file), expected);
  });
}
