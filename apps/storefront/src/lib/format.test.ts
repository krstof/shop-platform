import { describe, expect, it } from "vitest";
import { absaetze, euro, fehltBisKostenlos, lieferzeit, steuerHinweis, versandText } from "./format.js";

describe("Anzeige in der Storefront", () => {
  it("zeigt Cent als Euro", () => {
    expect(euro(890).replace(/\s/g, " ")).toBe("8,90 €");
    expect(euro(123456).replace(/\s/g, " ")).toBe("1.234,56 €");
  });
  it("nennt MwSt. und Versand", () => {
    expect(steuerHinweis(7)).toBe("inkl. 7 % MwSt., versandkostenfrei");
    const nb = (t: string) => t.replace(/\s/g, " ");
    expect(nb(steuerHinweis(19, { amount: 490, freeFrom: 5000 }))).toBe(
      "inkl. 19 % MwSt., zzgl. 4,90 € Versand (ab 50,00 € versandkostenfrei)",
    );
    expect(nb(versandText({ amount: 590, freeFrom: null }))).toBe("zzgl. 5,90 € Versand");
  });
  it("rechnet, was bis zum kostenlosen Versand fehlt", () => {
    const v = { amount: 490, freeFrom: 5000 };
    expect(fehltBisKostenlos(4000, v)).toBe(1000);
    expect(fehltBisKostenlos(5000, v)).toBeUndefined();
    expect(fehltBisKostenlos(0, v)).toBeUndefined();
    expect(fehltBisKostenlos(4000, { amount: 490, freeFrom: null })).toBeUndefined();
  });
  it("nennt die Lieferzeit", () => {
    expect(lieferzeit(null)).toBe("Sofort lieferbar.");
    expect(lieferzeit({ min: 2, max: 3 })).toBe("Lieferzeit 2–3 Werktage.");
    expect(lieferzeit({ min: 1, max: 1 })).toBe("Lieferzeit 1 Werktag.");
  });
  it("teilt Text in Absätze", () => {
    expect(absaetze("Eins.\n\n  Zwei.\n \nDrei.\n")).toEqual(["Eins.", "Zwei.", "Drei."]);
    expect(absaetze("")).toEqual([]);
  });
});
