import { describe, expect, it } from "vitest";
import type { StoreProduct } from "./catalog.js";
import { sortStoreProducts } from "./sort.js";

const p = (name: string, amount: number | null): StoreProduct => ({
  id: name,
  name,
  slug: name.toLowerCase(),
  description: "",
  price: amount === null ? null : { amount, currency: "EUR" },
  compareAtPrice: null,
  newBadge: "auto",
  publishedAt: null,
  deliveryDays: null,
  taxRatePercent: 19,
  inStock: true,
  maxQuantity: 1,
  categoryId: null,
  categoryIds: [],
  images: [],
});
const list = [p("Sencha", 890), p("Ohne Preis", null), p("Assam", 590), p("Öl-Tee", 1290), p("Bancha", 590)];
const names = (l: StoreProduct[]) => l.map((x) => x.name);

describe("sortStoreProducts", () => {
  it("standard und neueste", () => {
    expect(names(sortStoreProducts(list, "standard"))).toEqual(names(list));
    expect(names(sortStoreProducts(list, "newest"))).toEqual(names([...list].reverse()));
  });
  it("Name nach deutscher Ordnung (Ö bei O)", () => {
    expect(names(sortStoreProducts(list, "name"))).toEqual([
      "Assam",
      "Bancha",
      "Ohne Preis",
      "Öl-Tee",
      "Sencha",
    ]);
  });
  it("Preis auf- und absteigend, gleicher Preis nach Name, ohne Preis am Ende", () => {
    expect(names(sortStoreProducts(list, "price-asc"))).toEqual([
      "Assam",
      "Bancha",
      "Sencha",
      "Öl-Tee",
      "Ohne Preis",
    ]);
    expect(names(sortStoreProducts(list, "price-desc"))).toEqual([
      "Öl-Tee",
      "Sencha",
      "Assam",
      "Bancha",
      "Ohne Preis",
    ]);
  });
  it("ändert die Eingabe nicht", () => {
    const copy = [...list];
    sortStoreProducts(list, "name");
    expect(list).toEqual(copy);
  });
});
