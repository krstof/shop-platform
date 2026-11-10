// Fassade für andere Module (M6): veröffentlichte Produkte für Warenkorb und Kasse lesen.
// Liefert alles, was eine Bestellung als Momentaufnahme braucht (Name, Preis, Steuerklasse, Bild).
import { withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { storeProductReader, type StoreProduct } from "./http/store/catalog.js";
import { imageIdsOf } from "./internal/product-image-repository.js";
import { findPublishedProductsByIds } from "./internal/product-repository.js";
import type { ProductImages, ProductPrices, ProductStock } from "./ports.js";

export interface SellableProduct extends StoreProduct {
  readonly variantId: string;
  readonly sku: string | null;
  readonly taxClass: "standard" | "reduced";
  /** Erstes Bild (Modul media), für die Bestellung. */
  readonly imageMediaId: string | null;
}

export interface CatalogReader {
  /** Veröffentlichte Produkte zu Produkt- oder Variantenkennungen; Unbekanntes fehlt. */
  sellable(ids: {
    productIds?: readonly string[] | undefined;
    variantIds?: readonly string[] | undefined;
  }): Promise<SellableProduct[]>;
}

export interface CatalogReaderDependencies {
  readonly database: Database<unknown>;
  readonly prices: ProductPrices;
  readonly stock: ProductStock;
  readonly images: ProductImages;
}

export function createCatalogReader(deps: CatalogReaderDependencies): CatalogReader {
  const db = deps.database as Database<DB>;
  const read = storeProductReader(deps);
  return {
    sellable: (ids) =>
      withTenantTransaction(db, async (trx) => {
        const rows = await findPublishedProductsByIds(trx, ids);
        const [products, imageIds] = await Promise.all([
          read(trx, rows),
          imageIdsOf(
            trx,
            rows.map((r) => r.id),
          ),
        ]);
        return rows.map((r, i) => ({
          ...(products[i] as StoreProduct),
          variantId: r.variant_id,
          sku: r.sku,
          taxClass: r.tax_class_code,
          imageMediaId: imageIds.get(r.id)?.[0] ?? null,
        }));
      }),
  };
}
