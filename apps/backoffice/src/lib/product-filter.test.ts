import { describe, expect, it } from "vitest";
import { isFiltered, parseProductFilter, productListPath, sortProducts } from "./product-filter.js";

const CAT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("Filter der Produktliste", () => {
  it("liest gültige Werte aus der Adresse", () => {
    expect(parseProductFilter({ suche: "  Earl Grey ", kategorie: CAT, status: "entwurf" })).toEqual({
      suche: "Earl Grey",
      kategorie: CAT,
      status: "entwurf",
    });
  });

  it("ignoriert leere, kaputte und unbekannte Werte", () => {
    expect(parseProductFilter({ suche: "   ", kategorie: "abc", status: "alle", foo: 1 })).toEqual({});
    expect(parseProductFilter({ suche: 42, kategorie: null })).toEqual({});
    expect(parseProductFilter({ kategorie: `${CAT}' OR 1=1` })).toEqual({});
  });

  it("entfernt Steuerzeichen und kürzt auf 100 Zeichen", () => {
    expect(parseProductFilter({ suche: "Tee\u0000\nmix" }).suche).toBe("Tee  mix");
    expect(parseProductFilter({ suche: "x".repeat(150) }).suche).toHaveLength(100);
  });

  it("baut die API-Adresse mit sauber kodierten Werten", () => {
    expect(productListPath({})).toBe("/admin/v1/products");
    expect(productListPath({ suche: "50% & mehr", kategorie: CAT, status: "sichtbar" })).toBe(
      `/admin/v1/products?q=50%25+%26+mehr&categoryId=${CAT}&status=published`,
    );
    expect(productListPath({ status: "entwurf" })).toBe("/admin/v1/products?status=draft");
  });

  it("erkennt, ob gefiltert wird", () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ status: "sichtbar" })).toBe(true);
  });

  it("liest die Sortierung; Standard „neueste“ bleibt aus der Adresse", () => {
    expect(parseProductFilter({ sortierung: "preis-auf" })).toEqual({ sortierung: "preis-auf" });
    expect(parseProductFilter({ sortierung: "neueste" })).toEqual({});
    expect(parseProductFilter({ sortierung: "billig" })).toEqual({});
    expect(isFiltered({ sortierung: "name" })).toBe(false);
  });

  it("sortiert nach Name, Verkaufspreis (Angebot zählt) und Bestand", () => {
    const p = (name: string, price: number | null, stock: number, sale?: number) => ({
      name,
      price: price === null ? null : { amount: price },
      salePrice: sale === undefined ? null : { amount: sale },
      stock,
    });
    const list = [p("Sencha", 890, 5), p("Assam", 590, 0), p("Ohne", null, 9), p("Oolong", 1290, 2, 490)];
    const names = (l: { name: string }[]) => l.map((x) => x.name);
    expect(names(sortProducts(list))).toEqual(["Oolong", "Ohne", "Assam", "Sencha"]);
    expect(names(sortProducts(list, "aelteste"))).toEqual(["Sencha", "Assam", "Ohne", "Oolong"]);
    expect(names(sortProducts(list, "name"))).toEqual(["Assam", "Ohne", "Oolong", "Sencha"]);
    expect(names(sortProducts(list, "preis-auf"))).toEqual(["Oolong", "Assam", "Sencha", "Ohne"]);
    expect(names(sortProducts(list, "preis-ab"))).toEqual(["Sencha", "Assam", "Oolong", "Ohne"]);
    expect(names(sortProducts(list, "bestand"))).toEqual(["Assam", "Oolong", "Sencha", "Ohne"]);
  });
});
