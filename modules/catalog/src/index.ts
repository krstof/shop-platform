// EINZIGE öffentliche Datei des Moduls catalog (Architektur 3.3, Regel 3).
// Andere Module und Programme importieren nur von hier: Fassade, Ereignistypen, DTOs, Endpunkte.
import type { Endpoint } from "@shop/http";
import type { Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { categoryEndpoints } from "./http/admin/categories.js";
import { manufacturerEndpoints } from "./http/admin/manufacturers.js";
import { productImageEndpoints } from "./http/admin/product-images.js";
import { productEndpoints } from "./http/admin/products.js";
import { storeCatalogEndpoints } from "./http/store/catalog.js";
import type { ProductImages, ProductPrices, ProductStock } from "./ports.js";

export type { Manufacturer } from "./http/admin/manufacturer.schema.js";
export type { Product } from "./http/admin/product.schema.js";
export type { StoreProduct } from "./http/store/catalog.js";
export {
  createCatalogReader,
  type CatalogReader,
  type CatalogReaderDependencies,
  type SellableProduct,
} from "./catalog-reader.js";
export type { Category } from "./http/admin/category.schema.js";
export type {
  ImageRejection,
  PreparedProductImage,
  ProductImage,
  ProductImages,
  ProductPrices,
  ProductStock,
} from "./ports.js";
export {
  catalogEvents,
  categoryCreated,
  categoryUpdated,
  manufacturerCreated,
  manufacturerUpdated,
  productCreated,
  productUpdated,
} from "./catalog.events.js";

export interface CatalogDependencies {
  /** Verbindung als Rolle shop_app. Der Zugriff läuft ausschließlich über withTenantTransaction. */
  readonly database: Database<unknown>;
  /** Grundpreise (Modul pricing, zusammengesteckt in apps/api). */
  readonly prices: ProductPrices;
  /** Bestand (Modul inventory, zusammengesteckt in apps/api). */
  readonly stock: ProductStock;
  /** Bilder (Modul media, zusammengesteckt in apps/api). */
  readonly images: ProductImages;
}

/** Alle HTTP-Endpunkte des Moduls. Das Programm api registriert sie; die Datenbank bleibt eingeschlossen. */
export function catalogEndpoints(deps: CatalogDependencies): Endpoint[] {
  // Der Griff ist derselbe für alle Module; die Typen des eigenen Schemas legt das Modul darüber.
  const db = deps.database as Database<DB>;
  return [
    ...manufacturerEndpoints(db),
    ...categoryEndpoints(db),
    ...productEndpoints({ db, prices: deps.prices, stock: deps.stock, images: deps.images }),
    ...productImageEndpoints({ db, prices: deps.prices, stock: deps.stock, images: deps.images }),
    // Storefront-API (M4): nur Sichtbares, öffentlich je Shop.
    ...storeCatalogEndpoints({ db, prices: deps.prices, stock: deps.stock, images: deps.images }),
  ];
}
