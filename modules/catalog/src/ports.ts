// Was der Katalog von Preisen und Bestand braucht (M2). Die Module pricing und inventory erfüllen
// diese Schnittstellen mit ihren Fassaden; zusammengesteckt wird in apps/api (endpoints.ts), damit
// catalog die beiden Module nicht kennen muss. Aufrufe innerhalb einer Katalog-Transaktion laufen
// in derselben Transaktion (withTenantTransaction verschachtelt sich).

export interface ProductPrices {
  setBasePrice(price: { variantId: string; amount: number; currency: string }): Promise<void>;
  getBasePrices(variantIds: readonly string[], currency: string): Promise<Map<string, number>>;
  /** Angebotspreis setzen; `null` entfernt ihn. */
  setSalePrice(variantId: string, amount: number | null, currency: string): Promise<void>;
  getSalePrices(variantIds: readonly string[], currency: string): Promise<Map<string, number>>;
}

export interface ProductStock {
  setOnHand(variantId: string, quantity: number): Promise<void>;
  getAvailable(variantIds: readonly string[]): Promise<Map<string, number>>;
  /** Mindestbestand je Variante setzen (Paket P5); `null` nimmt die Angabe weg. */
  setLowStockThreshold(variantId: string, threshold: number | null): Promise<void>;
  /** Mindestbestände je Variante; ohne Angabe fehlt der Eintrag. */
  getLowStockThresholds(variantIds: readonly string[]): Promise<Map<string, number>>;
}

/** Ein fertiges Produktbild (Modul media). */
export interface ProductImage {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
}

/** Warum ein Bild abgelehnt wurde. */
export type ImageRejection = "unsupported_format" | "too_large" | "too_small" | "unreadable";

/** Geprüftes, umgerechnetes Bild, das noch gespeichert werden muss; oder die Ablehnung. */
export type PreparedProductImage =
  | { readonly ok: true; save(): Promise<ProductImage> }
  | { readonly ok: false; readonly reason: ImageRejection };

/** Was der Katalog von Bildern braucht (M2 Teil 2). Erfüllt das Modul media. */
export interface ProductImages {
  /** Prüft und rechnet um, ohne Datenbank. Gehört nicht in eine Transaktion (rechenintensiv). */
  prepare(data: Uint8Array, filename?: string): Promise<PreparedProductImage>;
  get(ids: readonly string[]): Promise<Map<string, ProductImage>>;
  /** Löscht Bilder samt Dateien. Erst nach der eigenen Transaktion aufrufen. */
  remove(ids: readonly string[]): Promise<void>;
}
