import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli-args.js";

describe("Befehlszeile von shop-testdb", () => {
  it("versteht run mit Befehl", () => {
    expect(parseArgs(["run", "--", "pnpm", "-s", "test"])).toEqual({
      kind: "run",
      command: ["pnpm", "-s", "test"],
    });
  });

  it("versteht migrated mit Datenbank und Variable", () => {
    expect(parseArgs(["migrated", "shop_codegen", "SHOP_CODEGEN_URL", "--", "node", "x.mjs"])).toEqual({
      kind: "migrated",
      database: "shop_codegen",
      envVar: "SHOP_CODEGEN_URL",
      command: ["node", "x.mjs"],
    });
  });

  it.each([
    [["run"], "Befehl"],
    [["run", "--"], "Befehl"],
    [["start", "--", "x"], "Unbekannt"],
    [["migrated", "x", "--", "y"], "Unbekannt"],
    [["migrated", "Shop-DB", "URL", "--", "y"], "Datenbankname"],
    [["migrated", "shop; DROP", "URL", "--", "y"], "Datenbankname"],
    [["migrated", "shop", "url", "--", "y"], "Variablenname"],
  ])("lehnt ab: %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});
