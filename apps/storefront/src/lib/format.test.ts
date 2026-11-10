import { describe, expect, it } from "vitest";
import { absaetze, euro, steuerHinweis } from "./format.js";

describe("Anzeige in der Storefront", () => {
  it("zeigt Cent als Euro", () => {
    expect(euro(890).replace(/\s/g, " ")).toBe("8,90 €");
    expect(euro(123456).replace(/\s/g, " ")).toBe("1.234,56 €");
  });
  it("nennt MwSt. und Versand", () => {
    expect(steuerHinweis(7)).toBe("inkl. 7 % MwSt., versandkostenfrei");
  });
  it("teilt Text in Absätze", () => {
    expect(absaetze("Eins.\n\n  Zwei.\n \nDrei.\n")).toEqual(["Eins.", "Zwei.", "Drei."]);
    expect(absaetze("")).toEqual([]);
  });
});
