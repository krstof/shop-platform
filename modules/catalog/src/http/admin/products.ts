// Produkte in der Admin-API (M2): auflisten, lesen, anlegen, ändern. Preis und Bestand schreiben
// die Module pricing und inventory über ihre Fassaden in derselben Transaktion mit.
import {
  decodeCursor,
  defineEndpoint,
  idParam,
  listQuery,
  pageOf,
  singleLineText,
  toPage,
  type Endpoint,
} from "@shop/http";
import {
  getContext,
  NotFoundError,
  parseVideoUrl,
  PreconditionFailedError,
  publishEvent,
  ValidationError,
  withTenantTransaction,
  type Database,
  type Transaction,
} from "@shop/kernel";
import { z } from "zod";
import { diff, productCreated, productDeleted, productUpdated } from "../../catalog.events.js";
import type { DB } from "../../db.generated.js";
import { categoryExists } from "../../internal/category-repository.js";
import { withConflictMapping } from "../../internal/conflicts.js";
import {
  archiveProduct,
  findProductById,
  findProducts,
  freeProductSlug,
  insertProduct,
  updateProduct,
  type ProductRow,
  type ProductVideo,
} from "../../internal/product-repository.js";
import { appendImage, imageIdsOf } from "../../internal/product-image-repository.js";
import type { ProductImage, ProductImages, ProductPrices, ProductStock, ProductVideos } from "../../ports.js";
import {
  createProductInput,
  CURRENCY,
  productFacts,
  productSchema,
  toProduct,
  toProductValues,
  updateProductInput,
  type Product,
} from "./product.schema.js";

const cursorKey = z.strictObject({ id: z.uuid() });

const UNKNOWN_CATEGORY = "Diese Kategorie gibt es im Shop nicht.";
const SALE_TOO_HIGH = "Der Angebotspreis muss kleiner als der normale Preis sein.";

/** Angebot nur unter dem normalen Preis; sonst 422 am Feld salePrice. */
function requireSaleBelow(sale: number | null | undefined, price: number | undefined): void {
  if (sale === null || sale === undefined || price === undefined || sale < price) return;
  throw new ValidationError({
    detail: SALE_TOO_HIGH,
    errors: [{ path: "/salePrice/amount", code: "sale_not_below_price", message: SALE_TOO_HIGH }],
  });
}

const VIDEO_URL_FALSCH =
  "Bitte die Adresse eines Videos bei YouTube oder Vimeo angeben, etwa https://www.youtube.com/watch?v=…";

/** Liest die Videoadresse aus der Eingabe; wirft 422, wenn sie zu keinem erlaubten Anbieter gehört. */
function videoFromUrl(url: string, autoplay: boolean): ProductVideo {
  const ref = parseVideoUrl(url);
  if (ref === undefined)
    throw new ValidationError({
      detail: VIDEO_URL_FALSCH,
      errors: [{ path: "/videoUrl", code: "unknown_video_provider", message: VIDEO_URL_FALSCH }],
    });
  return { kind: ref.provider, mediaId: null, providerId: ref.id, posterMediaId: null, autoplay };
}

export interface ProductEndpointDependencies {
  readonly db: Database<DB>;
  readonly prices: ProductPrices;
  readonly stock: ProductStock;
  readonly images: ProductImages;
  readonly videos: ProductVideos;
  /**
   * Wird nach dem Anlegen oder Ändern eines sichtbaren Produkts aufgerufen (22.11.2026). Gedacht
   * für IndexNow: Suchmaschinen erfahren sofort, dass es die Seite gibt. Fehler ändern nichts am
   * Produkt, deshalb wird hier nicht gewartet, ob es geklappt hat.
   */
  readonly onPublished?: ((product: { readonly slug: string }) => Promise<void>) | undefined;
}

/** Liest Produkte vollständig: Zeilen plus Preis, Bestand und Bilder (vier Abfragen je Seite). */
export function productReader({ prices, stock, images, videos }: Omit<ProductEndpointDependencies, "db">) {
  return async function withDetails(trx: Transaction<DB>, rows: readonly ProductRow[]): Promise<Product[]> {
    const ids = rows.map((r) => r.variant_id);
    const imageIds = await imageIdsOf(
      trx,
      rows.map((r) => r.id),
    );
    const videoIds = rows
      .map((r) => (r.video?.kind === "file" ? r.video.mediaId : null))
      .filter((id): id is string => id !== null);
    const posterIds = rows
      .map((r) => r.video?.posterMediaId ?? null)
      .filter((id): id is string => id !== null);
    const [p, sale, s, img, low, vid] = await Promise.all([
      prices.getBasePrices(ids, CURRENCY),
      prices.getSalePrices(ids, CURRENCY),
      stock.getAvailable(ids),
      images.get([...imageIds.values()].flat().concat(posterIds)),
      stock.getLowStockThresholds(ids),
      videos.get(videoIds),
    ]);
    return rows.map((r) => {
      const list = (imageIds.get(r.id) ?? [])
        .map((id) => img.get(id))
        .filter((i): i is ProductImage => i !== undefined);
      return toProduct(
        r,
        p.get(r.variant_id),
        s.get(r.variant_id),
        list,
        sale.get(r.variant_id),
        low.get(r.variant_id),
        r.video === null || r.video.mediaId === null ? undefined : vid.get(r.video.mediaId),
        r.video === null || r.video.posterMediaId === null ? undefined : img.get(r.video.posterMediaId),
      );
    });
  };
}

export function productEndpoints(deps: ProductEndpointDependencies): Endpoint[] {
  const { db, prices, stock } = deps;
  const withDetails = productReader(deps);

  /** Meldet eine sichtbar gewordene Produktseite nach außen, ohne den Aufrufer warten zu lassen. */
  async function announce(slug: string): Promise<void> {
    await deps.onPublished?.({ slug }).catch(() => undefined);
  }

  async function requireCategory(
    trx: Transaction<DB>,
    id: string | null | undefined,
    ids?: readonly string[],
  ): Promise<void> {
    if (id !== undefined && id !== null && !(await categoryExists(trx, id)))
      throw new ValidationError({
        detail: UNKNOWN_CATEGORY,
        errors: [{ path: "/categoryId", code: "unknown_category", message: UNKNOWN_CATEGORY }],
      });
    for (const [i, c] of (ids ?? []).entries())
      if (!(await categoryExists(trx, c)))
        throw new ValidationError({
          detail: UNKNOWN_CATEGORY,
          errors: [{ path: `/categoryIds/${i}`, code: "unknown_category", message: UNKNOWN_CATEGORY }],
        });
  }

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/products",
    operationId: "listProducts",
    summary: "Produkte auflisten",
    description:
      "Listet die Produkte des Shops mit Preis, Bestand und Bildern in Anlagereihenfolge, seitenweise mit " +
      "Cursor. Filter nach Status und Kategorie möglich, `q` sucht ohne Groß-/Kleinschreibung im Namen " +
      "und in der Artikelnummer.",
    tags: ["Produkte"],
    access: { scopes: ["products:read"] },
    query: listQuery({
      status: z.enum(["draft", "published"]).optional(),
      categoryId: z.uuid().optional(),
      q: singleLineText(100).optional().meta({ description: "Suchtext für Name oder Artikelnummer." }),
    }),
    response: { status: 200, description: "Eine Seite mit Produkten.", schema: pageOf(productSchema) },
    handler: async ({ query, locale }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const page = await withTenantTransaction(db, async (trx) => {
        const rows = await findProducts(trx, {
          limit: query.limit,
          afterId: after,
          status: query.status,
          categoryId: query.categoryId,
          search: query.q,
        });
        const visible = rows.slice(0, query.limit);
        const items = await withDetails(trx, visible);
        return { rows, items };
      });
      const byId = new Map(page.items.map((p) => [p.id, p]));
      return toPage(
        page.rows,
        query.limit,
        (r) => ({ id: r.id }),
        (r) => byId.get(r.id) as Product,
      );
    },
  });

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/products/{productId}",
    operationId: "getProduct",
    summary: "Produkt lesen",
    description: "Liest ein Produkt des Shops mit Preis, Bestand und Bildern.",
    tags: ["Produkte"],
    access: { scopes: ["products:read"] },
    params: z.strictObject({ productId: idParam }),
    response: { status: 200, description: "Das Produkt.", schema: productSchema },
    problems: [404],
    handler: async ({ params }) => {
      const product = await withTenantTransaction(db, async (trx) => {
        const row = await findProductById(trx, params.productId);
        return row === undefined ? undefined : (await withDetails(trx, [row]))[0];
      });
      if (product === undefined) throw new NotFoundError();
      return product;
    },
  });

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/products",
    operationId: "createProduct",
    summary: "Produkt anlegen",
    description:
      "Legt ein Produkt mit Bruttopreis, Steuersatz und Bestand an, zunächst als Entwurf (`draft`), " +
      "mit `status: published` gleich sichtbar im Shop. Ohne `slug` entsteht die Adresse aus dem " +
      "Namen. Eine schon vergebene Adresse oder Artikelnummer ergibt 409.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    body: createProductInput,
    bodyExample: {
      name: "Sencha Frühlingshauch",
      description: "Ein klassischer gedämpfter Grüntee aus Shizuoka.",
      price: { amount: 890, currency: "EUR" },
      taxClass: "reduced",
      stock: 25,
      status: "published",
    },
    response: { status: 201, description: "Das angelegte Produkt.", schema: productSchema },
    problems: [409],
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      return withConflictMapping(() =>
        withTenantTransaction(db, async (trx) => {
          await requireCategory(trx, body.categoryId, body.categoryIds);
          requireSaleBelow(body.salePrice?.amount, body.price.amount);
          const slug = body.slug ?? (await freeProductSlug(trx, body.name));
          const video =
            body.videoUrl === undefined || body.videoUrl === null
              ? undefined
              : videoFromUrl(body.videoUrl, body.videoAutoplay ?? false);
          const row = await insertProduct(trx, tenantId, {
            ...toProductValues(body),
            ...(video === undefined ? {} : { video }),
            name: body.name,
            slug,
          });
          await prices.setBasePrice({
            variantId: row.variant_id,
            amount: body.price.amount,
            currency: CURRENCY,
          });
          if (body.salePrice !== undefined && body.salePrice !== null)
            await prices.setSalePrice(row.variant_id, body.salePrice.amount, CURRENCY);
          await stock.setOnHand(row.variant_id, body.stock ?? 0);
          if (body.lowStockThreshold !== undefined && body.lowStockThreshold !== null)
            await stock.setLowStockThreshold(row.variant_id, body.lowStockThreshold);
          await publishEvent(trx, productCreated, { id: row.id, name: row.name });
          return (await withDetails(trx, [row]))[0] as Product;
        }),
      ).then(async (product) => {
        if (product.status === "published") await announce(product.slug);
        return product;
      });
    },
  });

  const update = defineEndpoint({
    api: "admin",
    method: "PATCH",
    path: "/products/{productId}",
    operationId: "updateProduct",
    summary: "Produkt ändern",
    description:
      "Ändert die mitgeschickten Felder eines Produkts, auch Preis und Bestand. `categoryId: null` " +
      "nimmt es aus der Kategorie. Verlangt die aktuelle Version als If-Match aus dem ETag; hat " +
      "inzwischen jemand anders geändert, kommt 412.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    body: updateProductInput,
    bodyExample: { price: { amount: 950 }, stock: 40 },
    ifMatch: "required",
    response: { status: 200, description: "Das geänderte Produkt.", schema: productSchema },
    problems: [404, 409, 412, 428],
    handler: async ({ params, body, ifMatch }) => {
      const tenantId = getContext()?.tenantId ?? "";
      const result = await withConflictMapping(() =>
        withTenantTransaction(db, async (trx) => {
          await requireCategory(trx, body.categoryId, body.categoryIds);
          // Videoadresse: `null` nimmt das Video weg, eine Adresse ersetzt es. Lag vorher eine
          // eigene Datei am Produkt, wird sie nach der Transaktion gelöscht.
          const video =
            body.videoUrl === undefined
              ? undefined
              : body.videoUrl === null
                ? null
                : videoFromUrl(body.videoUrl, body.videoAutoplay ?? false);
          const r = await updateProduct(trx, tenantId, params.productId, ifMatch ?? 0, {
            ...toProductValues(body),
            ...(video === undefined ? {} : { video }),
          });
          if (r.kind !== "updated") return r;
          const altesVideo = r.before.video;
          const [before] = await withDetails(trx, [r.before]);
          // Neues Angebot gegen den neuen Preis prüfen; neuer Preis gegen ein bestehendes Angebot.
          const sale = body.salePrice === undefined ? before?.salePrice?.amount : body.salePrice?.amount;
          requireSaleBelow(sale, body.price?.amount ?? before?.price?.amount);
          if (body.salePrice !== undefined)
            await prices.setSalePrice(r.row.variant_id, body.salePrice?.amount ?? null, CURRENCY);
          if (body.price !== undefined)
            await prices.setBasePrice({
              variantId: r.row.variant_id,
              amount: body.price.amount,
              currency: CURRENCY,
            });
          if (body.stock !== undefined) await stock.setOnHand(r.row.variant_id, body.stock);
          if (body.lowStockThreshold !== undefined)
            await stock.setLowStockThreshold(r.row.variant_id, body.lowStockThreshold);
          const [after] = await withDetails(trx, [r.row]);
          if (before === undefined || after === undefined) throw new Error("Produkt nicht lesbar");
          const changes = diff(productFacts(before), productFacts(after));
          if (Object.keys(changes).length > 0)
            await publishEvent(trx, productUpdated, { id: r.row.id, changes });
          const verwaisteDatei =
            video !== undefined && altesVideo?.kind === "file" ? altesVideo.mediaId : null;
          const verwaistesBild = video !== undefined ? (altesVideo?.posterMediaId ?? null) : null;
          return { kind: "updated" as const, product: after, verwaisteDatei, verwaistesBild };
        }),
      );
      if (result.kind === "not_found") throw new NotFoundError();
      if (result.kind === "version_mismatch") throw new PreconditionFailedError();
      // Erst nach dem Commit: Die Datei ist weg, sobald niemand mehr auf sie zeigt.
      if (result.verwaisteDatei !== null) await deps.videos.remove([result.verwaisteDatei]);
      if (result.verwaistesBild !== null) await deps.images.remove([result.verwaistesBild]);
      if (result.product.status === "published") await announce(result.product.slug);
      return result.product;
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/products/{productId}",
    operationId: "deleteProduct",
    summary: "Produkt löschen",
    description:
      "Löscht ein Produkt: Es verschwindet aus dem Shop und aus allen Listen, die Artikelnummer wird " +
      "wieder frei. Bestehende Bestellungen behalten ihre Angaben (intern wird das Produkt nur " +
      "archiviert). Nur aus dem Shop nehmen, ohne zu löschen: `status: draft` mit PATCH.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    response: { status: 200, description: "Gelöscht.", schema: deletedSchema },
    problems: [404],
    handler: async ({ params }) => {
      const before = await withTenantTransaction(db, async (trx) => {
        const row = await archiveProduct(trx, params.productId);
        if (row !== undefined) await publishEvent(trx, productDeleted, { id: row.id, name: row.name });
        return row;
      });
      if (before === undefined) throw new NotFoundError();
      return { id: before.id, deleted: true as const };
    },
  });

  const copy = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/products/{productId}/copy",
    operationId: "copyProduct",
    summary: "Produkt kopieren",
    description:
      "Legt eine Kopie an: gleicher Text, Preis (auch Angebotspreis), Steuersatz, Kategorie und dieselben Bilder, Name mit " +
      "„(Kopie)“, eigene Adresse, ohne Artikelnummer, Bestand 0 und als Entwurf (noch nicht im Shop). " +
      "Die Bilder teilen sich Original und Kopie; entfernt man eines bei einem der beiden, bleibt es beim anderen.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    response: { status: 201, description: "Die Kopie.", schema: productSchema },
    problems: [404],
    handler: async ({ params }) => {
      const tenantId = getContext()?.tenantId ?? "";
      const result = await withTenantTransaction(db, async (trx) => {
        const row = await findProductById(trx, params.productId);
        if (row === undefined) return undefined;
        const [source] = await withDetails(trx, [row]);
        if (source === undefined) return undefined;
        const name = copyName(source.name);
        const slug = await freeProductSlug(trx, name);
        const created = await insertProduct(trx, tenantId, {
          name,
          slug,
          description: source.description === "" ? null : source.description,
          status: "draft",
          tax_class_code: source.taxClass,
          category_ids: source.categoryIds,
          sku: null,
          delivery_days: source.deliveryDays,
        });
        if (source.price !== null)
          await prices.setBasePrice({
            variantId: created.variant_id,
            amount: source.price.amount,
            currency: CURRENCY,
          });
        if (source.salePrice !== null)
          await prices.setSalePrice(created.variant_id, source.salePrice.amount, CURRENCY);
        await stock.setOnHand(created.variant_id, 0);
        for (const image of source.images) await appendImage(trx, tenantId, created.id, image.id);
        await publishEvent(trx, productCreated, { id: created.id, name: created.name });
        return (await withDetails(trx, [created]))[0];
      });
      if (result === undefined) throw new NotFoundError();
      return result;
    },
  });

  return [list, get, create, update, remove, copy];
}

/** „Sencha“ → „Sencha (Kopie)“, gekürzt auf die erlaubten 200 Zeichen. */
export function copyName(name: string): string {
  const suffix = " (Kopie)";
  return `${name.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
}

const deletedSchema = z
  .object({ id: z.uuid(), deleted: z.literal(true) })
  .meta({ id: "DeletedProduct", description: "Bestätigung, dass das Produkt gelöscht ist." });
