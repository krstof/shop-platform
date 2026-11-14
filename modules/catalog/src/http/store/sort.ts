// Sortierung der Produkte in der Storefront-API (Auswahl „Sortieren“ im Shop).

export const STORE_SORTS = ["standard", "newest", "price-asc", "price-desc", "name"] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

/** Was die Sortierung braucht (StoreProduct erfüllt das; kein Import, sonst Kreis). */
export interface Sortable {
  readonly name: string;
  readonly price: { readonly amount: number } | null;
}

const byName = new Intl.Collator("de", { sensitivity: "base", numeric: true });

/**
 * Sortiert eine Liste (höchstens 200) im Speicher. „standard“ lässt die Anlagereihenfolge,
 * „newest“ dreht sie um (IDs sind UUIDv7, also zeitlich geordnet). Ohne Preis immer am Ende.
 */
export function sortStoreProducts<T extends Sortable>(products: readonly T[], sort: StoreSort): T[] {
  const list = [...products];
  switch (sort) {
    case "standard":
      return list;
    case "newest":
      return list.reverse();
    case "name":
      return list.sort((a, b) => byName.compare(a.name, b.name));
    case "price-asc":
    case "price-desc": {
      const dir = sort === "price-asc" ? 1 : -1;
      return list.sort((a, b) => {
        if (a.price === null || b.price === null)
          return (a.price === null ? 1 : 0) - (b.price === null ? 1 : 0);
        return dir * (a.price.amount - b.price.amount) || byName.compare(a.name, b.name);
      });
    }
  }
}
