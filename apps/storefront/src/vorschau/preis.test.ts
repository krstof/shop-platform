import { describe, expect, it } from "vitest";
import { money } from "@shop/kernel";
import { grundpreisText, mengeText, preisText, steuerText } from "./preis.js";
import { KATEGORIEN, PRODUKTE } from "./daten.js";

const nbsp = (s: string) => s.replace(/\s/g, " ");

describe("Preisangaben", () => {
  it("zeigt Preise im deutschen Format", () => {
    expect(nbsp(preisText(money(1450, "EUR")))).toBe("14,50 €");
  });

  it("rechnet den Grundpreis je 100 g exakt und rundet kaufmännisch", () => {
    expect(nbsp(grundpreisText(money(1450, "EUR"), 75))).toBe("19,33 € / 100 g");
    expect(nbsp(grundpreisText(money(1190, "EUR"), 250))).toBe("4,76 € / 100 g");
    expect(nbsp(grundpreisText(money(550, "EUR"), 50))).toBe("11,00 € / 100 g");
    // 1 Cent auf 3 g: 33,33… Cent → 33 Cent
    expect(nbsp(grundpreisText(money(1, "EUR"), 3))).toBe("0,33 € / 100 g");
  });

  it("lehnt unsinnige Füllmengen ab", () => {
    expect(() => grundpreisText(money(100, "EUR"), 0)).toThrow(RangeError);
    expect(() => grundpreisText(money(100, "EUR"), 1.5)).toThrow(RangeError);
  });

  it("nennt Steuer und Versand", () => {
    expect(nbsp(steuerText(700))).toBe("inkl. 7 % MwSt., zzgl. Versand");
    expect(nbsp(mengeText(1000))).toBe("1.000 g");
  });
});

describe("Beispieldaten", () => {
  it("haben eindeutige Adressen und gültige Kategorien", () => {
    const slugs = PRODUKTE.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of PRODUKTE) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
      expect(KATEGORIEN.some((k) => k.slug === p.kategorie)).toBe(true);
      expect(p.preis.currency).toBe("EUR");
      expect(p.farbe).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const k of KATEGORIEN) expect(PRODUKTE.some((p) => p.kategorie === k.slug)).toBe(true);
  });
});
