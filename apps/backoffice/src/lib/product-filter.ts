// Suche und Filter der Produktliste. Die Filter stehen in der Adresse (/teeladen/produkte?suche=…),
// damit „Zurück“ im Browser und ein geteilter Link dieselbe Ansicht zeigen. Unbekannte oder kaputte
// Werte werden still ignoriert, statt die Seite scheitern zu lassen.

export type ProductStatusFilter = "sichtbar" | "entwurf";

export interface ProductFilter {
  suche?: string;
  kategorie?: string;
  status?: ProductStatusFilter;
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
  return out;
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
