// Produktbilder in der Admin-API (M2 Teil 2): hochladen, entfernen, Reihenfolge ändern.
// Das Bild kommt als Base64 im JSON (eine Schnittstelle für Backoffice, Partner und später die KI).
// Prüfen und Umrechnen übernimmt das Modul media, hier stehen nur Zuordnung und Reihenfolge.
// Jede Antwort ist das ganze Produkt, damit eine Oberfläche nichts nachladen muss.
import { defineEndpoint, idParam, singleLineText, type Endpoint } from "@shop/http";
import {
  ConflictError,
  getContext,
  NotFoundError,
  publishEvent,
  ValidationError,
  withTenantTransaction,
  type Transaction,
} from "@shop/kernel";
import { z } from "zod";
import { diff, productUpdated } from "../../catalog.events.js";
import type { DB } from "../../db.generated.js";
import {
  appendImage,
  detachImage,
  imageIdsOf,
  lockProduct,
  MAX_IMAGES_PER_PRODUCT,
  reorderImages,
  touchProduct,
} from "../../internal/product-image-repository.js";
import { findProductById } from "../../internal/product-repository.js";
import type { ImageRejection } from "../../ports.js";
import { productFacts, productSchema, type Product } from "./product.schema.js";
import { productReader, type ProductEndpointDependencies } from "./products.js";

/** Höchstgröße des Bildes vor Base64 (wie im Modul media). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Base64 macht aus 3 Bytes 4 Zeichen. */
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
/** Anfragegröße für den Upload: Base64 plus etwas Luft für Dateiname und JSON. */
export const IMAGE_UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;

const REJECTION_TEXT: Record<ImageRejection, string> = {
  unsupported_format: "Bitte ein Bild als JPEG, PNG oder WebP hochladen.",
  too_large: "Das Bild ist zu groß (höchstens 8 MB und 40 Megapixel).",
  too_small: "Das Bild ist zu klein (mindestens 32 × 32 Pixel).",
  unreadable: "Das Bild lässt sich nicht lesen. Ist die Datei beschädigt?",
};

const TOO_MANY = `Ein Produkt hat höchstens ${MAX_IMAGES_PER_PRODUCT} Bilder.`;
const ORDER_MISMATCH = "Die Liste muss genau die Bilder des Produkts enthalten, jedes einmal.";

const addImageInput = z.strictObject({
  data: z
    .base64()
    .max(MAX_BASE64_CHARS)
    .meta({ description: "Bilddatei als Base64 (JPEG, PNG oder WebP, höchstens 8 MB, kein SVG)." }),
  filename: singleLineText(200).optional().meta({ description: "Ursprünglicher Dateiname, nur zur Info." }),
});

const reorderInput = z.strictObject({
  imageIds: z
    .array(z.uuid())
    .max(MAX_IMAGES_PER_PRODUCT)
    .meta({ description: "Alle Bild-IDs des Produkts in der neuen Reihenfolge." }),
});

const imageParams = z.strictObject({ productId: idParam, imageId: idParam });

/** Kleines gültiges PNG (32 × 32 Pixel, grün) als Beispiel für Dokumentation und Tests. */
const EXAMPLE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAA1BMVEV6mluJCzqwAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEkl" +
  "EQVQ4y2NgGAWjYBSMAuwAAAQgAAFWu83mAAAAAElFTkSuQmCC";

export function productImageEndpoints(deps: ProductEndpointDependencies): Endpoint[] {
  const { db, images } = deps;
  const withDetails = productReader(deps);

  async function readProduct(trx: Transaction<DB>, id: string): Promise<Product> {
    const row = await findProductById(trx, id);
    if (row === undefined) throw new NotFoundError();
    return (await withDetails(trx, [row]))[0] as Product;
  }

  /** Nach einer Bildänderung: Version erhöhen, Ereignis schreiben, neuen Stand liefern. */
  async function finish(trx: Transaction<DB>, before: Product): Promise<Product> {
    await touchProduct(trx, before.id);
    const after = await readProduct(trx, before.id);
    const changes = diff(productFacts(before), productFacts(after));
    if (Object.keys(changes).length > 0) await publishEvent(trx, productUpdated, { id: after.id, changes });
    return after;
  }

  async function lock(trx: Transaction<DB>, id: string): Promise<Product> {
    if ((await lockProduct(trx, id)) !== "ok") throw new NotFoundError();
    return readProduct(trx, id);
  }

  const add = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/products/{productId}/images",
    operationId: "addProductImage",
    summary: "Produktbild hochladen",
    description:
      "Lädt ein Bild hoch (JPEG, PNG oder WebP als Base64, höchstens 8 MB) und hängt es hinten an. " +
      "Das Bild wird geprüft, aufgerichtet, von Zusatzdaten wie dem GPS-Ort befreit und als WebP in " +
      `zwei Größen ausgeliefert. Höchstens ${MAX_IMAGES_PER_PRODUCT} Bilder je Produkt (sonst 409). ` +
      "Antwort ist das ganze Produkt.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    body: addImageInput,
    bodyExample: { data: EXAMPLE_PNG, filename: "sencha.png" },
    bodyLimit: IMAGE_UPLOAD_BODY_LIMIT,
    response: { status: 201, description: "Das Produkt mit dem neuen Bild.", schema: productSchema },
    problems: [404, 409, 413],
    handler: async ({ params, body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      // Erst nachsehen, ob es das Produkt gibt (ein fremdes Produkt ergibt 404, nicht 422).
      await withTenantTransaction(db, (trx) => readProduct(trx, params.productId));
      // Rechnen vor der Transaktion: Das kann eine Sekunde dauern und soll nichts sperren.
      const prepared = await images.prepare(Buffer.from(body.data, "base64"), body.filename);
      if (!prepared.ok)
        throw new ValidationError({
          detail: REJECTION_TEXT[prepared.reason],
          errors: [{ path: "/data", code: prepared.reason, message: REJECTION_TEXT[prepared.reason] }],
        });
      return withTenantTransaction(db, async (trx) => {
        const before = await lock(trx, params.productId);
        if (before.images.length >= MAX_IMAGES_PER_PRODUCT) throw new ConflictError({ detail: TOO_MANY });
        const image = await prepared.save();
        await appendImage(trx, tenantId, params.productId, image.id);
        return finish(trx, before);
      });
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/products/{productId}/images/{imageId}",
    operationId: "deleteProductImage",
    summary: "Produktbild entfernen",
    description: "Nimmt ein Bild vom Produkt und löscht es samt Dateien. Antwort ist das ganze Produkt.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: imageParams,
    response: { status: 200, description: "Das Produkt ohne das Bild.", schema: productSchema },
    problems: [404],
    handler: async ({ params }) => {
      const product = await withTenantTransaction(db, async (trx) => {
        const before = await lock(trx, params.productId);
        if (!(await detachImage(trx, params.productId, params.imageId))) throw new NotFoundError();
        return finish(trx, before);
      });
      // Dateien erst löschen, wenn die Zuordnung sicher weg ist (nach dem Commit).
      await images.remove([params.imageId]);
      return product;
    },
  });

  const reorder = defineEndpoint({
    api: "admin",
    method: "PUT",
    path: "/products/{productId}/images",
    operationId: "reorderProductImages",
    summary: "Reihenfolge der Produktbilder ändern",
    description:
      "Setzt die Reihenfolge der Bilder. Die Liste enthält genau die Bild-IDs des Produkts; das erste " +
      "Bild ist das Hauptbild. Antwort ist das ganze Produkt.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    body: reorderInput,
    bodyExample: { imageIds: ["0192f0d8-6f1e-7c3a-9b2d-4e5f6a7b8c9d"] },
    response: { status: 200, description: "Das Produkt in neuer Reihenfolge.", schema: productSchema },
    problems: [404],
    handler: async ({ params, body }) =>
      withTenantTransaction(db, async (trx) => {
        const before = await lock(trx, params.productId);
        const current = (await imageIdsOf(trx, [params.productId])).get(params.productId) ?? [];
        const wanted = body.imageIds;
        const same =
          wanted.length === current.length &&
          new Set(wanted).size === wanted.length &&
          wanted.every((id) => current.includes(id));
        if (!same)
          throw new ValidationError({
            detail: ORDER_MISMATCH,
            errors: [{ path: "/imageIds", code: "image_ids_mismatch", message: ORDER_MISMATCH }],
          });
        await reorderImages(trx, params.productId, wanted);
        return finish(trx, before);
      }),
  });

  return [add, remove, reorder];
}
