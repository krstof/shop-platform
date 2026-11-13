import { describe, expect, it } from "vitest";
import {
  contrast,
  darker,
  DEFAULT_DESIGN,
  normalizeHex,
  readableWithWhite,
  readSettings,
  sameSettings,
} from "./design.js";

describe("Aussehen: Rechenregeln", () => {
  it("rechnet Kontraste wie WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Standardfarbe des Shops: gut lesbar mit weißer Schrift.
    expect(readableWithWhite("#3f6b4a")).toBe(true);
    // Hellgelb und Hellgrau: zu hell für weiße Schrift.
    expect(readableWithWhite("#ffd84d")).toBe(false);
    expect(readableWithWhite("#999999")).toBe(false);
    // #767676 ist die bekannte Grenze für 4,5 : 1 auf Weiß.
    expect(readableWithWhite("#767676")).toBe(true);
  });

  it("macht Farben dunkler und schreibt Hex klein", () => {
    expect(darker("#ffffff")).toBe("#bfbfbf");
    expect(darker("#3f6b4a")).toBe("#2f5038");
    expect(normalizeHex(" #AbC123 ")).toBe("#abc123");
    expect(normalizeHex("#abc")).toBeUndefined();
    expect(normalizeHex("red")).toBeUndefined();
  });

  it("liest gespeichertes JSON robust", () => {
    expect(readSettings({})).toEqual(DEFAULT_DESIGN);
    expect(readSettings(null)).toEqual(DEFAULT_DESIGN);
    expect(readSettings({ accentColor: "kaputt", font: "comic", logoImageId: 5 })).toEqual(DEFAULT_DESIGN);
    const s = { accentColor: "#1f5f8b", font: "modern", logoImageId: "0190a3c4-0000-7000-8000-000000000001" };
    expect(readSettings(s)).toEqual(s);
    expect(sameSettings(readSettings(s), readSettings(s))).toBe(true);
    expect(sameSettings(readSettings(s), DEFAULT_DESIGN)).toBe(false);
  });
});
