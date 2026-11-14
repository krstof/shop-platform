// „Das könnte dir auch gefallen“ unter einem Produkt: andere Produkte, verfügbare zuerst.
import type { StoreProduct } from "./store-api.js";

/** Bis zu `anzahl` andere Produkte aus der Liste; verfügbare vor ausverkauften, sonst Reihenfolge der Liste. */
export function aehnlicheProdukte(
  produkt: Pick<StoreProduct, "id">,
  liste: readonly StoreProduct[],
  anzahl = 4,
): StoreProduct[] {
  const andere = liste.filter((p) => p.id !== produkt.id);
  return [...andere.filter((p) => p.inStock), ...andere.filter((p) => !p.inStock)].slice(0, anzahl);
}
