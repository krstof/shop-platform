// Zuordnung Produkt → Bilder (M2 Teil 2) in catalog.product_media. Die Bilder selbst gehören dem
// Modul media; hier stehen nur deren IDs und die Reihenfolge. Läuft immer in withTenantTransaction.
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";

/** Höchstzahl der Bilder je Produkt. */
export const MAX_IMAGES_PER_PRODUCT = 20;

/** Bild-IDs je Produkt in Anzeigereihenfolge. Produkte ohne Bild fehlen in der Antwort. */
export async function imageIdsOf(
  trx: Transaction<DB>,
  productIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (productIds.length === 0) return result;
  const rows = await trx
    .selectFrom("catalog.product_media")
    .select(["product_id", "media_asset_id"])
    .where("product_id", "in", [...productIds])
    .where("variant_id", "is", null)
    .orderBy("product_id")
    .orderBy("position")
    .orderBy("id")
    .execute();
  for (const r of rows) {
    const list = result.get(r.product_id) ?? [];
    list.push(r.media_asset_id);
    result.set(r.product_id, list);
  }
  return result;
}

/** Hängt ein Bild hinten an. */
export async function appendImage(
  trx: Transaction<DB>,
  tenantId: string,
  productId: string,
  mediaAssetId: string,
): Promise<void> {
  const last = await trx
    .selectFrom("catalog.product_media")
    .select((eb) => eb.fn.max("position").as("max"))
    .where("product_id", "=", productId)
    .executeTakeFirst();
  const position = last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1;
  await trx
    .insertInto("catalog.product_media")
    .values({ tenant_id: tenantId, product_id: productId, media_asset_id: mediaAssetId, position })
    .execute();
}

/** Nimmt ein Bild vom Produkt. `false`, wenn es nicht zum Produkt gehört. */
export async function detachImage(
  trx: Transaction<DB>,
  productId: string,
  mediaAssetId: string,
): Promise<boolean> {
  const r = await trx
    .deleteFrom("catalog.product_media")
    .where("product_id", "=", productId)
    .where("media_asset_id", "=", mediaAssetId)
    .executeTakeFirst();
  return r.numDeletedRows > 0n;
}

/** Neue Reihenfolge; `ids` muss genau die Bilder des Produkts enthalten (prüft der Aufrufer). */
export async function reorderImages(
  trx: Transaction<DB>,
  productId: string,
  ids: readonly string[],
): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await trx
      .updateTable("catalog.product_media")
      .set({ position })
      .where("product_id", "=", productId)
      .where("media_asset_id", "=", id)
      .execute();
  }
}

/**
 * Sperrt das Produkt für die Änderung und prüft die Version (wenn angegeben). Danach muss der
 * Aufrufer `touchProduct` rufen, damit die Version die Bildänderung zeigt.
 */
export async function lockProduct(
  trx: Transaction<DB>,
  productId: string,
  expectedVersion?: number,
): Promise<"ok" | "not_found" | "version_mismatch"> {
  const row = await trx
    .selectFrom("catalog.product")
    .select("version")
    .where("id", "=", productId)
    .where("status", "<>", "archived")
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) return "not_found";
  if (expectedVersion !== undefined && row.version !== expectedVersion) return "version_mismatch";
  return "ok";
}

/** Erhöht die Version (Trigger) und den Änderungszeitpunkt. */
export async function touchProduct(trx: Transaction<DB>, productId: string): Promise<void> {
  await trx
    .updateTable("catalog.product")
    .set({ updated_at: new Date() })
    .where("id", "=", productId)
    .execute();
}
