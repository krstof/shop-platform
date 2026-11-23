// Seitenaufrufe zählen (P3): Pfad im Shop und Art der Seite.
import { describe, expect, it } from "vitest";
import { art, pfadImShop } from "./zaehler.js";

describe("Seitenaufrufe zählen", () => {
  it("schneidet die Shop-Kennung und den Anhang ab", () => {
    const p = (u: string, shop = "teeladen") => pfadImShop(new URL(u), shop);
    expect(p("https://shop.example/teeladen")).toBe("/");
    expect(p("https://shop.example/teeladen/")).toBe("/");
    expect(p("https://shop.example/teeladen/produkt/sencha")).toBe("/produkt/sencha");
    // Sortierung und Filter sind dieselbe Seite.
    expect(p("https://shop.example/teeladen/produkte?sortierung=preis")).toBe("/produkte");
    // Ein Pfad, der nicht mit dem Shop beginnt, bleibt wie er ist.
    expect(p("https://shop.example/anderer/produkt/x", "teeladen")).toBe("/anderer/produkt/x");
  });

  it("erkennt die Art der Seite", () => {
    expect(art("/")).toBe("start");
    expect(art("/produkt/sencha")).toBe("produkt");
    expect(art("/kategorie/gruentee")).toBe("kategorie");
    expect(art("/seite/ueber-uns")).toBe("seite");
    expect(art("/warenkorb")).toBe("sonstige");
  });
});
