// Ein- und Ausgaben für Produkte in der Admin-API (M2). Einfachste Form: ein Preis (brutto, EUR),
// ein Steuersatz (19 % oder 7 %), Bestand als Zahl, höchstens eine Kategorie, Bilder (Teil 2).
import { multiLineText, singleLineText, timestamp } from "@shop/http";
import { z } from "zod";
import type { ProductRow, ProductValues } from "../../internal/product-repository.js";
import type { ProductImage } from "../../ports.js";
import { slugInput } from "./category.schema.js";
import { productImageSchema } from "./image.schema.js";

export { productImageSchema };

export const CURRENCY = "EUR";

const priceSchema = z
  .object({
    amount: z
      .number()
      .int()
      .min(0)
      .meta({ description: "Bruttopreis in Cent, zum Beispiel 890 für 8,90 €." }),
    currency: z.literal(CURRENCY),
  })
  .meta({ id: "Price" });

export const productSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["draft", "published"]).meta({ description: "`draft` = Entwurf, `published` = im Shop." }),
    name: z.string(),
    slug: z.string(),
    description: z.string().meta({ description: "Klartext, Absätze durch Leerzeilen getrennt." }),
    taxClass: z
      .enum(["standard", "reduced"])
      .meta({ description: "`standard` = 19 %, `reduced` = 7 % (Deutschland)." }),
    price: priceSchema.nullable(),
    salePrice: priceSchema.nullable().meta({
      description:
        "Angebotspreis (brutto). Gesetzt: Der Shop verkauft zu diesem Preis und zeigt `price` durchgestrichen.",
    }),
    stock: z.number().int().meta({ description: "Verfügbarer Bestand (vorhanden minus reserviert)." }),
    categoryId: z.uuid().nullable(),
    sku: z.string().nullable().meta({ description: "Artikelnummer." }),
    images: z
      .array(productImageSchema)
      .meta({ description: "Bilder in Anzeigereihenfolge, das erste ist das Hauptbild." }),
    publishedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "Product", description: "Produkt mit Preis und Bestand." });

export type Product = z.infer<typeof productSchema>;

export function toProduct(
  row: ProductRow,
  price: number | undefined,
  stock: number | undefined,
  images: readonly ProductImage[],
  salePrice?: number,
): Product {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    slug: row.slug,
    description: row.description,
    taxClass: row.tax_class_code,
    price: price === undefined ? null : { amount: price, currency: CURRENCY },
    salePrice: salePrice === undefined ? null : { amount: salePrice, currency: CURRENCY },
    stock: stock ?? 0,
    categoryId: row.category_id,
    sku: row.sku,
    images: images.map((i) => ({ ...i })),
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

const priceInput = z.strictObject({
  amount: z.number().int().min(0).max(100_000_000).meta({ description: "Bruttopreis in Cent." }),
  currency: z.literal(CURRENCY).optional().meta({ description: "Nur EUR. Ohne Angabe EUR." }),
});

const fields = {
  salePrice: priceInput
    .nullable()
    .optional()
    .meta({ description: "Angebotspreis in Cent, kleiner als der Preis. `null` beendet das Angebot." }),
  slug: slugInput.optional(),
  description: multiLineText(5000).nullable().optional(),
  status: z.enum(["draft", "published"]).optional(),
  taxClass: z.enum(["standard", "reduced"]).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional().meta({ description: "Bestand im Lager." }),
  categoryId: z.uuid().nullable().optional(),
  sku: singleLineText(64).nullable().optional(),
};

export const createProductInput = z.strictObject({ name: singleLineText(200), price: priceInput, ...fields });
export const updateProductInput = z
  .strictObject({ name: singleLineText(200).optional(), price: priceInput.optional(), ...fields })
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld ändern.")
  .meta({ minProperties: 1 });

export type UpdateProductInput = z.output<typeof updateProductInput>;

export function toProductValues(input: UpdateProductInput): ProductValues {
  const v: ProductValues = {};
  if (input.name !== undefined) v.name = input.name;
  if (input.slug !== undefined) v.slug = input.slug;
  if (input.description !== undefined) v.description = input.description;
  if (input.status !== undefined) v.status = input.status;
  if (input.taxClass !== undefined) v.tax_class_code = input.taxClass;
  if (input.categoryId !== undefined) v.category_id = input.categoryId;
  if (input.sku !== undefined) v.sku = input.sku;
  return v;
}

/** Felder für das Änderungs-Ereignis. */
export function productFacts(p: Product): Record<string, string | number | null> {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    status: p.status,
    taxClass: p.taxClass,
    price: p.price?.amount ?? null,
    salePrice: p.salePrice?.amount ?? null,
    stock: p.stock,
    categoryId: p.categoryId,
    sku: p.sku,
    images: p.images.length === 0 ? null : p.images.map((i) => i.id).join(","),
  };
}
