// Suche und Filter der Produktliste. Die Filter stehen in der Adresse (/teeladen/produkte?suche=…),
// damit „Zurück“ im Browser und ein geteilter Link dieselbe Ansicht zeigen. Unbekannte oder kaputte
// Werte werden still ignoriert, statt die Seite scheitern zu lassen.

export type ProductStatusFilter = "sichtbar" | "entwurf";

/** Reihenfolge der Liste (nur im Browser, die API liefert in Anlagereihenfolge). */
export const PRODUCT_SORTS = [
  { value: "neueste", label: "Neueste zuerst" },
  { value: "aelteste", label: "Älteste zuerst" },
  { value: "name", label: "Name A–Z" },
  { value: "preis-auf", label: "Preis aufsteigend" },
  { value: "preis-ab", label: "Preis absteigend" },
  { value: "bestand", label: "Bestand, wenigster zuerst" },
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number]["value"];

export interface ProductFilter {
  suche?: string;
  kategorie?: string;
  status?: ProductStatusFilter;
  sortierung?: ProductSort;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEARCH = 100;
// eslint-disable-next-line no-control-regex -- genau diese Zeichen sollen entfernt werden
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Liest die Filter aus den Suchparametern der Adresse. */
export function parseProductFilter(raw: Record<string, unknown>): ProductFilter {
  const out: ProductFilter = {};
  if (typeof raw.suche === "string") {
    // Steuerzeichen raus (die API lehnt sie ab), Leerraum am Rand weg, Länge wie in der API.
    const text = raw.suche.replace(CONTROL, " ").trim().slice(0, MAX_SEARCH).trim();
    if (text !== "") out.suche = text;
  }
  if (typeof raw.kategorie === "string" && UUID.test(raw.kategorie))
    out.kategorie = raw.kategorie.toLowerCase();
  if (raw.status === "sichtbar" || raw.status === "entwurf") out.status = raw.status;
  const sort = PRODUCT_SORTS.find((x) => x.value === raw.sortierung);
  // „neueste“ ist der Standard und bleibt aus der Adresse draußen.
  if (sort !== undefined && sort.value !== "neueste") out.sortierung = sort.value;
  return out;
}

interface Sortable {
  readonly name: string;
  readonly price: { readonly amount: number } | null;
  readonly salePrice?: { readonly amount: number } | null;
  readonly stock: number;
}

const byName = new Intl.Collator("de", { sensitivity: "base", numeric: true });
/** Preis, zu dem der Shop verkauft (Angebot vor Normalpreis); ohne Preis ganz hinten. */
const sellingPrice = (p: Sortable) => p.salePrice?.amount ?? p.price?.amount ?? Number.POSITIVE_INFINITY;

/**
 * Sortiert die Liste. Die API liefert in Anlagereihenfolge (älteste zuerst); ohne Angabe gilt
 * „neueste zuerst“, wie man es aus Listen kennt.
 */
export function sortProducts<T extends Sortable>(list: readonly T[], sort: ProductSort = "neueste"): T[] {
  const l = [...list];
  switch (sort) {
    case "aelteste":
      return l;
    case "neueste":
      return l.reverse();
    case "name":
      return l.sort((a, b) => byName.compare(a.name, b.name));
    case "preis-auf":
      return l.sort((a, b) => sellingPrice(a) - sellingPrice(b) || byName.compare(a.name, b.name));
    case "preis-ab":
      return l.sort((a, b) => {
        const pa = sellingPrice(a);
        const pb = sellingPrice(b);
        if (pa === Number.POSITIVE_INFINITY || pb === Number.POSITIVE_INFINITY)
          return pa === pb ? 0 : pa === Number.POSITIVE_INFINITY ? 1 : -1;
        return pb - pa || byName.compare(a.name, b.name);
      });
    case "bestand":
      return l.sort((a, b) => a.stock - b.stock || byName.compare(a.name, b.name));
  }
}

/** Ist irgendein Filter gesetzt? */
export function isFiltered(f: ProductFilter): boolean {
  return f.suche !== undefined || f.kategorie !== undefined || f.status !== undefined;
}

/** Adresse der Admin-API für die gefilterte Liste. */
export function productListPath(f: ProductFilter): string {
  const params = new URLSearchParams();
  if (f.suche !== undefined) params.set("q", f.suche);
  if (f.kategorie !== undefined) params.set("categoryId", f.kategorie);
  if (f.status !== undefined) params.set("status", f.status === "sichtbar" ? "published" : "draft");
  const qs = params.toString();
  return qs === "" ? "/admin/v1/products" : `/admin/v1/products?${qs}`;
}
