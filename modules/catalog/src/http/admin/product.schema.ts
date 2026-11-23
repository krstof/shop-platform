// Ein- und Ausgaben für Produkte in der Admin-API (M2). Einfachste Form: ein Preis (brutto, EUR),
// ein Steuersatz (19 % oder 7 %), Bestand als Zahl, höchstens eine Kategorie, Bilder (Teil 2).
import { multiLineText, singleLineText, timestamp } from "@shop/http";
import { z } from "zod";
import type { ProductRow, ProductValues } from "../../internal/product-repository.js";
import type { ProductImage, ProductVideoFile } from "../../ports.js";
import { videoWatchUrl } from "@shop/kernel";
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

const deliveryDaysSchema = z
  .object({ min: z.number().int(), max: z.number().int() })
  .meta({ id: "DeliveryDays", description: "Lieferzeit in Werktagen." });

const deliveryDaysInput = z
  .strictObject({ min: z.number().int().min(0).max(120), max: z.number().int().min(0).max(120) })
  .refine((d) => d.max >= d.min, { message: "„bis“ muss mindestens so groß sein wie „von“.", path: ["max"] });

export const productVideoSchema = z
  .object({
    kind: z.enum(["file", "youtube", "vimeo"]).meta({
      description: "`file` = eigene Datei im Shop, sonst ein Video bei YouTube oder Vimeo.",
    }),
    url: z.string().meta({
      description:
        "Bei `file` die Adresse der Datei zum Abspielen, sonst die Adresse beim Anbieter zum Anschauen.",
    }),
    providerId: z
      .string()
      .nullable()
      .meta({ description: "Kennung des Videos bei YouTube oder Vimeo, sonst null." }),
    posterUrl: z.string().nullable().meta({
      description:
        "Vorschaubild der eigenen Datei (Standbild aus dem Video), sonst null. Der Shop zeigt es vor dem Abspielen.",
    }),
    posterThumbnailUrl: z
      .string()
      .nullable()
      .meta({ description: "Dasselbe Vorschaubild klein, für die Galerie." }),
    autoplay: z.boolean().meta({
      description: "Startet im Shop von selbst, immer ohne Ton (sonst lässt der Browser es nicht zu).",
    }),
  })
  .meta({ id: "ProductVideo", description: "Video am Produkt: eigene Datei oder YouTube/Vimeo." });

export type ProductVideoView = z.infer<typeof productVideoSchema>;

/** Baut die Ansicht des Videos; ohne Video oder ohne lesbare Datei: null. */
export function toProductVideo(
  row: ProductRow,
  file: ProductVideoFile | undefined,
  poster?: ProductImage | undefined,
): ProductVideoView | null {
  const v = row.video;
  if (v === null) return null;
  if (v.kind === "file")
    return file === undefined
      ? null
      : {
          kind: "file",
          url: file.url,
          providerId: null,
          posterUrl: poster?.url ?? null,
          posterThumbnailUrl: poster?.thumbnailUrl ?? null,
          autoplay: v.autoplay,
        };
  const url = v.providerId === null ? undefined : videoWatchUrl(v.kind, v.providerId);
  if (url === undefined || v.providerId === null) return null;
  return {
    kind: v.kind,
    url,
    providerId: v.providerId,
    posterUrl: null,
    posterThumbnailUrl: null,
    autoplay: v.autoplay,
  };
}

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
    lowStockThreshold: z.number().int().nullable().meta({
      description:
        "Mindestbestand: Fällt `stock` auf diese Zahl oder darunter, gilt der Bestand als niedrig. null = keine Angabe.",
    }),
    newBadge: z.enum(["auto", "always", "never"]).meta({
      description:
        "Neu-Schildchen im Shop: `auto` = 14 Tage nach dem Veröffentlichen, `always` = immer, `never` = nie.",
    }),
    searchKeywords: z.string().nullable().meta({
      description: "Eigene Suchwörter, durch Komma getrennt; die Shop-Suche findet das Produkt auch darüber.",
    }),
    categoryId: z.uuid().nullable().meta({ description: "Hauptkategorie (erste aus `categoryIds`)." }),
    categoryIds: z
      .array(z.uuid())
      .meta({ description: "Alle Kategorien des Produkts, die Hauptkategorie zuerst." }),
    sku: z.string().nullable().meta({ description: "Artikelnummer." }),
    deliveryDays: deliveryDaysSchema
      .nullable()
      .meta({ description: "Lieferzeit in Werktagen, etwa 2 bis 3; null = nicht angegeben." }),
    images: z
      .array(productImageSchema)
      .meta({ description: "Bilder in Anzeigereihenfolge, das erste ist das Hauptbild." }),
    video: productVideoSchema
      .nullable()
      .meta({ description: "Video am Produkt oder null. Der Shop zeigt es neben den Bildern." }),
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
  lowStockThreshold?: number,
  videoFile?: ProductVideoFile,
  videoPoster?: ProductImage,
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
    lowStockThreshold: lowStockThreshold ?? null,
    newBadge: row.new_badge,
    searchKeywords: row.search_keywords,
    categoryId: row.category_id,
    categoryIds: [...row.category_ids],
    sku: row.sku,
    deliveryDays:
      row.delivery_time_min_days === null || row.delivery_time_max_days === null
        ? null
        : { min: row.delivery_time_min_days, max: row.delivery_time_max_days },
    images: images.map((i) => ({ ...i })),
    video: toProductVideo(row, videoFile, videoPoster),
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

/** Höchstens so viele Kategorien je Produkt. */
export const MAX_CATEGORIES_PER_PRODUCT = 10;

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
  lowStockThreshold: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .nullable()
    .optional()
    .meta({ description: "Mindestbestand; `null` nimmt die Angabe weg." }),
  newBadge: z.enum(["auto", "always", "never"]).optional(),
  searchKeywords: singleLineText(300)
    .nullable()
    .optional()
    .meta({ description: "Suchwörter, durch Komma getrennt; `null` nimmt sie weg." }),
  categoryId: z.uuid().nullable().optional().meta({
    description: "Hauptkategorie setzen (weitere bleiben); `null` nimmt das Produkt aus allen Kategorien.",
  }),
  categoryIds: z
    .array(z.uuid())
    .max(MAX_CATEGORIES_PER_PRODUCT)
    .optional()
    .meta({
      description: `Alle Kategorien neu setzen (bis zu ${MAX_CATEGORIES_PER_PRODUCT}), die erste ist die Hauptkategorie. Geht vor \`categoryId\`.`,
    }),
  sku: singleLineText(64).nullable().optional(),
  videoUrl: singleLineText(300)
    .nullable()
    .optional()
    .meta({
      description:
        "Adresse eines Videos bei YouTube oder Vimeo. `null` nimmt das Video weg, auch eine eigene Datei. " +
        "Eine eigene Datei lädt man über `POST /products/{productId}/video` hoch.",
    }),
  videoAutoplay: z
    .boolean()
    .optional()
    .meta({ description: "Video startet im Shop von selbst, immer ohne Ton." }),
  deliveryDays: deliveryDaysInput.nullable().optional(),
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
  if (input.newBadge !== undefined) v.new_badge = input.newBadge;
  if (input.searchKeywords !== undefined) v.search_keywords = input.searchKeywords;
  if (input.videoAutoplay !== undefined) v.video_autoplay = input.videoAutoplay;
  // videoUrl wird im Endpunkt gelesen und geprüft (dort ist bekannt, ob eine Datei zu löschen ist).
  if (input.categoryId !== undefined) v.category_id = input.categoryId;
  if (input.categoryIds !== undefined) v.category_ids = input.categoryIds;
  if (input.sku !== undefined) v.sku = input.sku;
  if (input.deliveryDays !== undefined) v.delivery_days = input.deliveryDays;
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
    lowStockThreshold: p.lowStockThreshold,
    newBadge: p.newBadge,
    searchKeywords: p.searchKeywords,
    categoryId: p.categoryId,
    categories: p.categoryIds.length === 0 ? null : p.categoryIds.join(","),
    sku: p.sku,
    deliveryDays: p.deliveryDays === null ? null : `${p.deliveryDays.min}-${p.deliveryDays.max}`,
    images: p.images.length === 0 ? null : p.images.map((i) => i.id).join(","),
    video: p.video === null ? null : `${p.video.kind}:${p.video.providerId ?? "datei"}`,
    videoAutoplay: p.video === null ? null : String(p.video.autoplay),
  };
}
