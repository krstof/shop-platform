import { describe, expect, it } from "vitest";
import { changeMerkzettel, parseMerkzettel } from "./merkzettel.js";

const A = "0190a3c4-0000-7000-8000-000000000001";
const B = "0190a3c4-0000-7000-8000-000000000002";

describe("Merkzettel", () => {
  it("liest nur gültige IDs, ohne Doppelte", () => {
    expect(parseMerkzettel(undefined)).toEqual([]);
    expect(parseMerkzettel(`${A}.kaputt.${A}.${B}`)).toEqual([A, B]);
  });
  it("fügt vorne ein und entfernt", () => {
    expect(changeMerkzettel([A], B, true)).toEqual([B, A]);
    expect(changeMerkzettel([A, B], A, false)).toEqual([B]);
    expect(changeMerkzettel([A], "<script>", true)).toEqual([A]);
  });
});
