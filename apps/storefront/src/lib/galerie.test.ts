import { describe, expect, it } from "vitest";
import { bildNummer } from "./galerie.js";

describe("bildNummer", () => {
  it("nimmt gültige Nummern, sonst 1", () => {
    expect(bildNummer("2", 3)).toBe(2);
    expect(bildNummer("3", 3)).toBe(3);
    expect(bildNummer("4", 3)).toBe(1);
    expect(bildNummer("0", 3)).toBe(1);
    expect(bildNummer("-1", 3)).toBe(1);
    expect(bildNummer("2abc", 3)).toBe(1);
    expect(bildNummer(null, 3)).toBe(1);
    expect(bildNummer("1", 0)).toBe(1);
  });
});
