// Was der Katalog von Preisen und Bestand braucht (M2). Die Module pricing und inventory erfüllen
// diese Schnittstellen mit ihren Fassaden; zusammengesteckt wird in apps/api (endpoints.ts), damit
// catalog die beiden Module nicht kennen muss. Aufrufe innerhalb einer Katalog-Transaktion laufen
// in derselben Transaktion (withTenantTransaction verschachtelt sich).

export interface ProductPrices {
  setBasePrice(price: { variantId: string; amount: number; currency: string }): Promise<void>;
  getBasePrices(variantIds: readonly string[], currency: string): Promise<Map<string, number>>;
}

export interface ProductStock {
  setOnHand(variantId: string, quantity: number): Promise<void>;
  getAvailable(variantIds: readonly string[]): Promise<Map<string, number>>;
}
