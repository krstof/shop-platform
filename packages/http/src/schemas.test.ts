import { describe, expect, it } from "vitest";
import { multiLineText, singleLineText } from "./schemas.js";

describe("Text-Eingaben (Sicherheit 5.4)", () => {
  it("einzeilig: trimmt, begrenzt, lehnt Steuerzeichen, Zeilenumbrüche und Ersatzzeichen ab", () => {
    const s = singleLineText(10);
    expect(s.parse("  Tee  ")).toBe("Tee");
    for (const bad of ["", "   ", "x".repeat(11), "Te\u0000e", "Te\ne", "Bcc:\r\nx", "a\u007f", "a\udbe7"])
      expect(s.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(s.safeParse("Grüner Tee").success).toBe(true);
  });

  it("mehrzeilig: Zeilenumbruch und Tabulator erlaubt, andere Steuerzeichen nicht", () => {
    const m = multiLineText(100);
    expect(m.parse("Hafenstraße 1\n20457 Hamburg")).toBe("Hafenstraße 1\n20457 Hamburg");
    expect(m.safeParse("a\tb").success).toBe(true);
    expect(m.safeParse("a\u0000b").success).toBe(false);
    expect(m.safeParse("a\u001bb").success).toBe(false);
  });
});
