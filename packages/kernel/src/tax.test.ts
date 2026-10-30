import { describe, expect, it } from "vitest";
import { add, money } from "./money.js";
import { formatRate, grossFromNet, netFromGross, rateBpSchema, taxFromGross, taxFromNet } from "./tax.js";

const eur = (n: number) => money(n, "EUR");

describe("Steuer aus Bruttopreisen (Endkunden, STR-01)", () => {
  it.each([
    // brutto, Satz, erwartete Steuer
    [1999, 1900, 319], // 19,99 € → 3,19 € (319,168)
    [119, 1900, 19], // 1,19 € → 0,19 € exakt
    [100, 1900, 16], // 1,00 € → 0,16 € (15,966)
    [107, 700, 7], // 1,07 € → 0,07 € exakt
    [499, 700, 33], // 4,99 € → 0,33 € (32,64)
    [1, 1900, 0], // 0,01 € → 0,00 € (0,159)
    [3, 1900, 0], // 0,03 € → 0,00 € (0,479)
    [4, 1900, 1], // 0,04 € → 0,01 € (0,639)
    [0, 1900, 0],
    [1000, 0, 0], // steuerfrei
    [1600, 1600, 221], // befristete Senkung 2020: 16 % (220,689…)
  ])("%i Cent bei %i bp → %i Cent Steuer", (gross, rate, tax) => {
    expect(taxFromGross(eur(gross), rate)).toEqual(eur(tax));
  });

  it("kaufmännische Rundung genau an der Hälfte", () => {
    // 1785 bei 19 %: 1785 × 1900 / 11900 = 285,0 exakt; 2975 → 475 exakt.
    expect(taxFromGross(eur(1785), 1900)).toEqual(eur(285));
    // 5,35 € bei 7 %: 535 × 700 / 10700 = 35 exakt; 0,15 € bei 7 %: 0,98… → 1
    expect(taxFromGross(eur(15), 700)).toEqual(eur(1));
  });

  it("Netto plus Steuer ergibt immer exakt Brutto", () => {
    for (let gross = 0; gross <= 5000; gross += 7) {
      for (const rate of [0, 700, 1900]) {
        const g = eur(gross);
        expect(add(netFromGross(g, rate), taxFromGross(g, rate))).toEqual(g);
      }
    }
  });

  it("rundet negative Beträge (Gutschrift) symmetrisch", () => {
    expect(taxFromGross(eur(-1999), 1900)).toEqual(eur(-319));
  });

  it("Steuer bleibt ganzzahlig auch bei großen Beträgen", () => {
    expect(taxFromGross(eur(1_000_000_000_00), 1900)).toEqual(eur(15_966_386_555));
  });
});

describe("Steuer aus Nettopreisen (B2B, ab Welle 3)", () => {
  it("rechnet Netto zu Brutto", () => {
    expect(taxFromNet(eur(1000), 1900)).toEqual(eur(190));
    expect(grossFromNet(eur(1680), 1900)).toEqual(eur(1999)); // 319,2 → 319
    expect(taxFromNet(eur(5), 1900, "half_even")).toEqual(eur(1)); // 0,95 → 1
  });
});

describe("Basispunkte", () => {
  it("erlaubt 0 bis 100000", () => {
    expect(rateBpSchema.safeParse(1900).success).toBe(true);
    expect(rateBpSchema.safeParse(-1).success).toBe(false);
    expect(rateBpSchema.safeParse(100_001).success).toBe(false);
    expect(rateBpSchema.safeParse(19.5).success).toBe(false);
    expect(() => taxFromGross(eur(100), 19.5)).toThrow();
  });

  it("zeigt Prozent an", () => {
    expect(formatRate(1900)).toBe("19 %");
    expect(formatRate(700)).toBe("7 %");
    expect(formatRate(550)).toBe("5,5 %");
    expect(formatRate(0)).toBe("0 %");
    expect(formatRate(1925)).toBe("19,25 %");
  });
});
