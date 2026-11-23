// Video am Produkt in der Admin-API (Paket P5, Kristof 23.11.2026): eigene Datei hochladen und
// Video wieder wegnehmen. Ein Video bei YouTube oder Vimeo braucht keinen Upload; dafür reicht
// `videoUrl` beim Ändern des Produkts (products.ts).
//
// Wie beim Bild kommt die Datei als Base64 im JSON, damit Backoffice, Partner und später die KI
// dieselbe Schnittstelle nutzen. Umgerechnet wird nichts (siehe Modul media).
import { defineEndpoint, idParam, singleLineText, type Endpoint } from "@shop/http";
import {
  NotFoundError,
  publishEvent,
  ValidationError,
  withTenantTransaction,
  type Transaction,
} from "@shop/kernel";
import { z } from "zod";
import { diff, productUpdated } from "../../catalog.events.js";
import type { DB } from "../../db.generated.js";
import { lockProduct, touchProduct } from "../../internal/product-image-repository.js";
import { findProductById, updateProduct } from "../../internal/product-repository.js";
import type { VideoRejection } from "../../ports.js";
import { productFacts, productSchema, type Product } from "./product.schema.js";
import { productReader, type ProductEndpointDependencies } from "./products.js";

/**
 * Höchstgröße der Datei vor Base64. Das Modul media erlaubt 25 MB; durch die Leitung passen aber
 * nur 16 MB je Anfrage (Grenze aller Endpunkte, packages/http), und Base64 macht aus 3 Bytes 4
 * Zeichen. Darum hier 10 MB — das reicht für einen kurzen Produktfilm. Wer ein längeres Video
 * zeigen will, lädt es bei YouTube oder Vimeo hoch und setzt den Link ein.
 */
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;
/** Anfragegröße für den Upload: Base64 plus etwas Luft für Dateiname und JSON. */
export const VIDEO_UPLOAD_BODY_LIMIT = 14 * 1024 * 1024;

const REJECTION_TEXT: Record<VideoRejection, string> = {
  unsupported_format: "Bitte ein Video als MP4 oder WebM hochladen.",
  too_large:
    "Das Video ist zu groß (höchstens 10 MB). Kürzer schneiden oder bei YouTube hochladen und den Link einsetzen.",
  unreadable: "Die Datei lässt sich nicht lesen. Ist sie beschädigt?",
};

/** Höchstgröße des Vorschaubildes vor Base64 (wie bei Produktbildern). */
const MAX_POSTER_BASE64_CHARS = Math.ceil((2 * 1024 * 1024) / 3) * 4;

const addVideoInput = z.strictObject({
  data: z
    .base64()
    .max(MAX_BASE64_CHARS)
    .meta({ description: "Videodatei als Base64 (MP4 oder WebM, höchstens 10 MB)." }),
  poster: z
    .base64()
    .max(MAX_POSTER_BASE64_CHARS)
    .optional()
    .meta({
      description:
        "Vorschaubild als Base64 (JPEG, PNG oder WebP): ein Standbild aus dem Video. Das Backoffice " +
        "erzeugt es beim Hochladen im Browser. Ohne Angabe zeigt der Shop ein dunkles Feld mit Dreieck.",
    }),
  filename: singleLineText(200).optional().meta({ description: "Ursprünglicher Dateiname, nur zur Info." }),
  autoplay: z
    .boolean()
    .optional()
    .meta({ description: "Startet im Shop von selbst, immer ohne Ton. Ohne Angabe: nein." }),
});

/** Kleinstmögliches MP4-Gerüst als Beispiel für die Dokumentation (spielt nichts ab). */
const EXAMPLE_MP4 = "AAAAGGZ0eXBpc29tAAAAAGlzb21tcDQy";

export function productVideoEndpoints(deps: ProductEndpointDependencies): Endpoint[] {
  const { db, videos } = deps;
  const withDetails = productReader(deps);

  async function readProduct(trx: Transaction<DB>, id: string): Promise<Product> {
    const row = await findProductById(trx, id);
    if (row === undefined) throw new NotFoundError();
    return (await withDetails(trx, [row]))[0] as Product;
  }

  async function finish(trx: Transaction<DB>, before: Product): Promise<Product> {
    await touchProduct(trx, before.id);
    const after = await readProduct(trx, before.id);
    const changes = diff(productFacts(before), productFacts(after));
    if (Object.keys(changes).length > 0) await publishEvent(trx, productUpdated, { id: after.id, changes });
    return after;
  }

  const add = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/products/{productId}/video",
    operationId: "addProductVideo",
    summary: "Video hochladen",
    description:
      "Lädt ein Video hoch (MP4 oder WebM als Base64, höchstens 10 MB) und hängt es an das Produkt. " +
      "Ein Produkt hat höchstens ein Video; ein vorhandenes wird ersetzt. Für YouTube und Vimeo " +
      "stattdessen `videoUrl` beim Ändern des Produkts benutzen. Antwort ist das ganze Produkt.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    body: addVideoInput,
    bodyExample: { data: EXAMPLE_MP4, filename: "sencha.mp4" },
    bodyLimit: VIDEO_UPLOAD_BODY_LIMIT,
    response: { status: 201, description: "Das Produkt mit dem Video.", schema: productSchema },
    problems: [404, 413],
    handler: async ({ params, body }) => {
      // Erst nachsehen, ob es das Produkt gibt (ein fremdes Produkt ergibt 404, nicht 422).
      await withTenantTransaction(db, (trx) => readProduct(trx, params.productId));
      const prepared = videos.prepare(Buffer.from(body.data, "base64"), body.filename);
      if (!prepared.ok)
        throw new ValidationError({
          detail: REJECTION_TEXT[prepared.reason],
          errors: [{ path: "/data", code: prepared.reason, message: REJECTION_TEXT[prepared.reason] }],
        });
      // Vorschaubild: Fehlt es oder taugt es nichts, geht der Upload trotzdem durch — dann zeigt
      // der Shop das dunkle Feld mit Dreieck.
      const posterVorbereitet =
        body.poster === undefined
          ? undefined
          : await deps.images.prepare(Buffer.from(body.poster, "base64"), "video-vorschau.jpg");
      const result = await withTenantTransaction(db, async (trx) => {
        if ((await lockProduct(trx, params.productId)) !== "ok") throw new NotFoundError();
        const before = await readProduct(trx, params.productId);
        const row = await findProductById(trx, params.productId);
        const alt = row?.video?.kind === "file" ? row.video.mediaId : null;
        const altesBild = row?.video?.posterMediaId ?? null;
        const datei = await prepared.save();
        const poster = posterVorbereitet?.ok === true ? await posterVorbereitet.save() : undefined;
        const geaendert = await updateProduct(trx, "", params.productId, before.version, {
          video: {
            kind: "file",
            mediaId: datei.id,
            providerId: null,
            posterMediaId: poster?.id ?? null,
            autoplay: body.autoplay ?? false,
          },
        });
        if (geaendert.kind !== "updated") throw new NotFoundError();
        return { product: await finish(trx, before), alt, altesBild };
      });
      // Die alten Dateien erst löschen, wenn niemand mehr auf sie zeigt (nach dem Commit).
      if (result.alt !== null) await videos.remove([result.alt]);
      if (result.altesBild !== null) await deps.images.remove([result.altesBild]);
      return result.product;
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/products/{productId}/video",
    operationId: "deleteProductVideo",
    summary: "Video entfernen",
    description:
      "Nimmt das Video vom Produkt. Eine eigene Datei wird dabei gelöscht, ein Video bei YouTube " +
      "oder Vimeo bleibt dort natürlich liegen. Antwort ist das ganze Produkt.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    response: { status: 200, description: "Das Produkt ohne Video.", schema: productSchema },
    problems: [404],
    handler: async ({ params }) => {
      const result = await withTenantTransaction(db, async (trx) => {
        if ((await lockProduct(trx, params.productId)) !== "ok") throw new NotFoundError();
        const before = await readProduct(trx, params.productId);
        const row = await findProductById(trx, params.productId);
        if (row === undefined || row.video === null) throw new NotFoundError();
        const alt = row.video.kind === "file" ? row.video.mediaId : null;
        const altesBild = row.video.posterMediaId;
        const geaendert = await updateProduct(trx, "", params.productId, before.version, { video: null });
        if (geaendert.kind !== "updated") throw new NotFoundError();
        return { product: await finish(trx, before), alt, altesBild };
      });
      if (result.alt !== null) await videos.remove([result.alt]);
      if (result.altesBild !== null) await deps.images.remove([result.altesBild]);
      return result.product;
    },
  });

  return [add, remove];
}
