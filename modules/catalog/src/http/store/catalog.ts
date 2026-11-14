// Katalog in der Storefront-API (M4): nur Sichtbares (veröffentlichte Produkte, sichtbare
// Kategorien), ohne interne Felder wie Artikelnummer oder genauen Bestand. Öffentlich, weil
// jeder Besucher eines Shops diese Daten sehen darf; der Shop kommt aus dem Pfad.
import { defineEndpoint, singleLineText, type Endpoint } from "@shop/http";
import { NotFoundError, withTenantTransaction, type Database, type Transaction } from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../../db.generated.js";
import { findCategories } from "../../internal/category-repository.js";
import { imageIdsOf } from "../../internal/product-image-repository.js";
import {
  findProducts,
  findPublishedProductBySlug,
  type ProductRow,
} from "../../internal/product-repository.js";
import { STORE_SORTS, sortStoreProducts } from "./sort.js";
import type { ProductImage, ProductImages, ProductPrices, ProductStock } from "../../ports.js";
import { CURRENCY, productImageSchema } from "../admin/product.schema.js";

/** Kürzel eines Shops im Pfad. */
export const shopHandleParam = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  .meta({ description: "Kürzel des Shops, etwa `teeladen`." });

const slugParam = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(200)
  .meta({ description: "Adresse (slug)." });

/** Höchstmenge je Position im Warenkorb (M6). */
export const MAX_QUANTITY = 99;

export const storeProductSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().meta({ description: "Klartext, Absätze durch Leerzeilen getrennt." }),
    price: z
      .object({ amount: z.number().int(), currency: z.literal(CURRENCY) })
      .nullable()
      .meta({ description: "Preis, zu dem der Shop verkauft (bei einem Angebot der Angebotspreis)." }),
    compareAtPrice: z
      .object({ amount: z.number().int(), currency: z.literal(CURRENCY) })
      .nullable()
      .meta({ description: "Bei einem Angebot der normale Preis (zum Durchstreichen), sonst null." }),
    taxRatePercent: z.number().int().meta({ description: "19 oder 7 (Deutschland), im Preis enthalten." }),
    inStock: z.boolean(),
    maxQuantity: z.number().int().meta({ description: "Höchstens so viele passen in den Warenkorb." }),
    categoryId: z.uuid().nullable(),
    images: z.array(productImageSchema),
  })
  .meta({ id: "StoreProduct", description: "Produkt, wie Besucher eines Shops es sehen." });

export type StoreProduct = z.infer<typeof storeProductSchema>;

const storeCategorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    image: productImageSchema.nullable().meta({ description: "Bild der Kategorie oder null." }),
  })
  .meta({ id: "StoreCategory" });

export interface StoreCatalogDependencies {
  readonly db: Database<DB>;
  readonly prices: ProductPrices;
  readonly stock: ProductStock;
  readonly images: ProductImages;
}

const PUBLIC = {
  public: true,
  reason: "Die Storefront zeigt jedem Besucher die veröffentlichten Produkte des Shops.",
} as const;

/** Liest veröffentlichte Produkte mit Preis, Verfügbarkeit und Bildern. */
export function storeProductReader({ prices, stock, images }: Omit<StoreCatalogDependencies, "db">) {
  return async (trx: Transaction<DB>, rows: readonly ProductRow[]): Promise<StoreProduct[]> => {
    const variantIds = rows.map((r) => r.variant_id);
    const imageIds = await imageIdsOf(
      trx,
      rows.map((r) => r.id),
    );
    const [p, sale, s, img] = await Promise.all([
      prices.getBasePrices(variantIds, CURRENCY),
      prices.getSalePrices(variantIds, CURRENCY),
      stock.getAvailable(variantIds),
      images.get([...imageIds.values()].flat()),
    ]);
    return rows.map((r) => {
      const base = p.get(r.variant_id);
      const offer = sale.get(r.variant_id);
      // Ein Angebot gilt nur unter dem normalen Preis (die Admin-API prüft das beim Speichern).
      const onSale = base !== undefined && offer !== undefined && offer < base;
      const price = onSale ? offer : base;
      const available = Math.max(0, s.get(r.variant_id) ?? 0);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        price: price === undefined ? null : { amount: price, currency: CURRENCY },
        compareAtPrice: onSale ? { amount: base, currency: CURRENCY } : null,
        taxRatePercent: r.tax_class_code === "reduced" ? 7 : 19,
        inStock: available > 0 && price !== undefined,
        maxQuantity: price === undefined ? 0 : Math.min(available, MAX_QUANTITY),
        categoryId: r.category_id,
        images: (imageIds.get(r.id) ?? [])
          .map((id) => img.get(id))
          .filter((i): i is ProductImage => i !== undefined)
          .map((i) => ({ ...i })),
      };
    });
  };
}

export function storeCatalogEndpoints(deps: StoreCatalogDependencies): Endpoint[] {
  const { db } = deps;
  const read = storeProductReader(deps);

  const categories = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/categories",
    operationId: "listStoreCategories",
    summary: "Kategorien des Shops",
    description: "Sichtbare Kategorien in der Reihenfolge des Shops.",
    tags: ["Storefront"],
    access: PUBLIC,
    params: z.strictObject({ shopHandle: shopHandleParam }),
    response: {
      status: 200,
      description: "Die Kategorien.",
      schema: z.object({ data: z.array(storeCategorySchema) }),
    },
    problems: [404],
    handler: async () => {
      const rows = (await withTenantTransaction(db, (trx) => findCategories(trx, { limit: 200 })))
        .slice(0, 200)
        .filter((c) => c.status === "visible");
      const ids = rows.map((c) => c.image_media_id).filter((id): id is string => id !== null);
      const found = ids.length === 0 ? new Map<string, ProductImage>() : await deps.images.get(ids);
      return {
        data: rows.map((c) => {
          const image = c.image_media_id === null ? undefined : found.get(c.image_media_id);
          return {
            id: c.id,
            name: c.name,
            slug: c.slug,
            description: c.description,
            image: image === undefined ? null : { ...image },
          };
        }),
      };
    },
  });

  const products = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/products",
    operationId: "listStoreProducts",
    summary: "Produkte des Shops",
    description:
      "Veröffentlichte Produkte (höchstens 200), wahlweise nur einer Kategorie oder nur Treffer einer Suche, sortiert nach `sort`.",
    tags: ["Storefront"],
    access: PUBLIC,
    params: z.strictObject({ shopHandle: shopHandleParam }),
    query: z.strictObject({
      category: slugParam.optional(),
      q: singleLineText(100).optional().meta({
        description: "Suchtext für Name oder Beschreibung (Teiltreffer, Groß-/Kleinschreibung egal).",
      }),
      sort: z.enum(STORE_SORTS).default("standard").meta({
        description:
          "`standard` (Anlagereihenfolge), `newest` (zuletzt angelegt zuerst), `price-asc`, `price-desc`, `name`. Ohne Preis immer am Ende.",
      }),
    }),
    response: {
      status: 200,
      description: "Die Produkte.",
      schema: z.object({ data: z.array(storeProductSchema) }),
    },
    problems: [404],
    handler: async ({ query }) =>
      withTenantTransaction(db, async (trx) => {
        let categoryId: string | undefined;
        if (query.category !== undefined) {
          const all = await findCategories(trx, { limit: 200 });
          const c = all.find((x) => x.slug === query.category && x.status === "visible");
          if (c === undefined) throw new NotFoundError();
          categoryId = c.id;
        }
        const rows = await findProducts(trx, {
          limit: 200,
          status: "published",
          categoryId,
          searchText: query.q,
        });
        return { data: sortStoreProducts(await read(trx, rows.slice(0, 200)), query.sort) };
      }),
  });

  const product = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/products/{productSlug}",
    operationId: "getStoreProduct",
    summary: "Produkt des Shops",
    description: "Ein veröffentlichtes Produkt zur Adresse (slug).",
    tags: ["Storefront"],
    access: PUBLIC,
    params: z.strictObject({ shopHandle: shopHandleParam, productSlug: slugParam }),
    response: { status: 200, description: "Das Produkt.", schema: storeProductSchema },
    problems: [404],
    handler: async ({ params }) => {
      const result = await withTenantTransaction(db, async (trx) => {
        const row = await findPublishedProductBySlug(trx, params.productSlug);
        return row === undefined ? undefined : (await read(trx, [row]))[0];
      });
      if (result === undefined) throw new NotFoundError();
      return result;
    },
  });

  return [categories, products, product];
}
