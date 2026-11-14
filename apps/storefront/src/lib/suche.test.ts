import { describe, expect, it } from "vitest";
import { SUCHE_MAX, suchbegriff, trefferText } from "./suche.js";

describe("suchbegriff", () => {
  it("lässt normalen Text stehen und schneidet Leerraum ab", () => {
    expect(suchbegriff("  Grüner Tee ")).toBe("Grüner Tee");
    expect(suchbegriff("100%_bio")).toBe("100%_bio");
  });
  it("leer, nur Leerraum oder fehlend: keine Suche", () => {
    expect(suchbegriff(null)).toBeUndefined();
    expect(suchbegriff(undefined)).toBeUndefined();
    expect(suchbegriff("")).toBeUndefined();
    expect(suchbegriff(" \t\n ")).toBeUndefined();
  });
  it("entfernt Steuerzeichen und fasst Leerraum zusammen", () => {
    expect(suchbegriff(`Sen${String.fromCharCode(0)}cha\r\nTee${String.fromCharCode(0x2028)}x`)).toBe(
      "Sen cha Tee x",
    );
  });
  it("kürzt auf die Höchstlänge der API", () => {
    expect(suchbegriff("a".repeat(250))).toHaveLength(SUCHE_MAX);
    expect(suchbegriff(`${"a".repeat(99)} b`)).toBe("a".repeat(99));
  });
});

describe("trefferText", () => {
  it("zählt Treffer", () => {
    expect(trefferText(0)).toBe("Keine Treffer");
    expect(trefferText(1)).toBe("1 Treffer");
    expect(trefferText(12)).toBe("12 Treffer");
  });
});
