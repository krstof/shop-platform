// EINZIGE öffentliche Datei des Moduls inventory (Architektur 3.3, Regel 3).
// MVP-Etappe M2: Bestand als einfache Zahl je Variante im Standardlager. Das Lager „Standard“
// entsteht beim ersten Bestand von selbst. Jede Änderung schreibt eine Lagerbewegung.
// Läuft ein Aufrufer schon in einer Transaktion für denselben Shop, schreibt die Fassade darin mit.
import { getContext, withTenantTransaction, type Database, type Transaction } from "@shop/kernel";
import type { DB } from "./db.generated.js";

export interface InventoryDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
}

/** Ein Artikel fehlt im Lager (Kauf, M6). */
export class OutOfStockError extends Error {
  constructor(readonly variantId: string) {
    super("Nicht genug Bestand");
    this.name = "OutOfStockError";
  }
}

export interface Inventory {
  /**
   * Nimmt Ware für eine Bestellung aus dem Lager (M6), alles oder nichts: Reicht der Bestand für eine
   * Position nicht, wirft es OutOfStockError, und die Transaktion des Aufrufers rollt alles zurück.
   */
  take(lines: readonly { variantId: string; quantity: number }[], orderId: string): Promise<void>;
  /** Legt Ware einer stornierten Bestellung zurück ins Standardlager (Bewegung „cancellation“). */
  putBack(lines: readonly { variantId: string; quantity: number }[], orderId: string): Promise<void>;
  /** Setzt den Bestand einer Variante im Standardlager auf genau diese Zahl. */
  setOnHand(variantId: string, quantity: number): Promise<void>;
  /** Verfügbarer Bestand (vorhanden minus reserviert) je Variante über alle Lager. Ohne Bestand: fehlt. */
  getAvailable(variantIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Mindestbestand einer Variante im Standardlager (Paket P5): Unterschreitet der verfügbare
   * Bestand diese Zahl, gilt der Bestand als niedrig. `null` nimmt die Angabe wieder weg.
   */
  setLowStockThreshold(variantId: string, threshold: number | null): Promise<void>;
  /** Mindestbestände je Variante. Ohne Angabe fehlt der Eintrag. */
  getLowStockThresholds(variantIds: readonly string[]): Promise<Map<string, number>>;
}

async function defaultLocationId(trx: Transaction<DB>, tenantId: string): Promise<string> {
  const found = await trx
    .selectFrom("inventory.stock_location")
    .select("id")
    .where("is_default", "=", true)
    .executeTakeFirst();
  if (found !== undefined) return found.id;
  await trx
    .insertInto("inventory.stock_location")
    .values({ tenant_id: tenantId, code: "standard", name: "Standardlager", is_default: true })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const row = await trx
    .selectFrom("inventory.stock_location")
    .select("id")
    .where("is_default", "=", true)
    .executeTakeFirstOrThrow();
  return row.id;
}

export function createInventory(deps: InventoryDependencies): Inventory {
  const db = deps.database as Database<DB>;
  return {
    async setOnHand(variantId, quantity) {
      if (!Number.isSafeInteger(quantity) || quantity < 0)
        throw new RangeError("Bestand muss ganz und ≥ 0 sein");
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, async (trx) => {
        const locationId = await defaultLocationId(trx, tenantId);
        const before = await trx
          .selectFrom("inventory.stock_level")
          .select("on_hand")
          .where("variant_id", "=", variantId)
          .where("location_id", "=", locationId)
          .forUpdate()
          .executeTakeFirst();
        const delta = quantity - (before?.on_hand ?? 0);
        if (before === undefined) {
          await trx
            .insertInto("inventory.stock_level")
            .values({
              tenant_id: tenantId,
              variant_id: variantId,
              location_id: locationId,
              on_hand: quantity,
            })
            .execute();
        } else if (delta !== 0) {
          await trx
            .updateTable("inventory.stock_level")
            .set({ on_hand: quantity })
            .where("variant_id", "=", variantId)
            .where("location_id", "=", locationId)
            .execute();
        }
        if (delta !== 0) {
          await trx
            .insertInto("inventory.stock_movement")
            .values({
              tenant_id: tenantId,
              variant_id: variantId,
              location_id: locationId,
              quantity_delta: delta,
              reason: before === undefined ? "initial" : "adjustment",
            })
            .execute();
        }
      });
    },

    async take(lines, orderId) {
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, async (trx) => {
        const locationId = await defaultLocationId(trx, tenantId);
        for (const { variantId, quantity } of lines) {
          if (!Number.isSafeInteger(quantity) || quantity < 1)
            throw new RangeError("Menge muss ganz und ≥ 1 sein");
          // Prüfen und Abziehen in einer Anweisung: zwei gleichzeitige Käufe können nicht beide gewinnen.
          const row = await trx
            .updateTable("inventory.stock_level")
            .set((eb) => ({ on_hand: eb("on_hand", "-", quantity) }))
            .where("variant_id", "=", variantId)
            .where("location_id", "=", locationId)
            .where("available", ">=", quantity)
            .returning("variant_id")
            .executeTakeFirst();
          if (row === undefined) throw new OutOfStockError(variantId);
          await trx
            .insertInto("inventory.stock_movement")
            .values({
              tenant_id: tenantId,
              variant_id: variantId,
              location_id: locationId,
              quantity_delta: -quantity,
              reason: "sale",
              reference_type: "order",
              reference_id: orderId,
            })
            .execute();
        }
      });
    },

    async putBack(lines, orderId) {
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, async (trx) => {
        const locationId = await defaultLocationId(trx, tenantId);
        for (const { variantId, quantity } of lines) {
          if (!Number.isSafeInteger(quantity) || quantity < 1)
            throw new RangeError("Menge muss ganz und ≥ 1 sein");
          const row = await trx
            .updateTable("inventory.stock_level")
            .set((eb) => ({ on_hand: eb("on_hand", "+", quantity) }))
            .where("variant_id", "=", variantId)
            .where("location_id", "=", locationId)
            .returning("variant_id")
            .executeTakeFirst();
          // Ohne Bestandszeile (Produkt inzwischen anders verwaltet): nichts zurückzulegen.
          if (row === undefined) continue;
          await trx
            .insertInto("inventory.stock_movement")
            .values({
              tenant_id: tenantId,
              variant_id: variantId,
              location_id: locationId,
              quantity_delta: quantity,
              reason: "cancellation",
              reference_type: "order",
              reference_id: orderId,
            })
            .execute();
        }
      });
    },

    async setLowStockThreshold(variantId, threshold) {
      if (threshold !== null && (!Number.isSafeInteger(threshold) || threshold < 0))
        throw new RangeError("Mindestbestand muss ganz und ≥ 0 sein");
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, async (trx) => {
        const locationId = await defaultLocationId(trx, tenantId);
        // Ohne Bestandszeile gibt es nichts zu merken; dann entsteht sie mit Bestand 0. Das ist
        // keine Lagerbewegung, weil sich am Bestand nichts ändert.
        await trx
          .insertInto("inventory.stock_level")
          .values({
            tenant_id: tenantId,
            variant_id: variantId,
            location_id: locationId,
            on_hand: 0,
            low_stock_threshold: threshold,
          })
          .onConflict((oc) =>
            oc
              .columns(["tenant_id", "variant_id", "location_id"])
              .doUpdateSet({ low_stock_threshold: threshold }),
          )
          .execute();
      });
    },

    async getLowStockThresholds(variantIds) {
      const result = new Map<string, number>();
      if (variantIds.length === 0) return result;
      const rows = await withTenantTransaction(db, (trx) =>
        trx
          .selectFrom("inventory.stock_level")
          .select(["variant_id", "low_stock_threshold"])
          .where("variant_id", "in", [...variantIds])
          .where("low_stock_threshold", "is not", null)
          .execute(),
      );
      for (const r of rows)
        if (r.low_stock_threshold !== null) result.set(r.variant_id, r.low_stock_threshold);
      return result;
    },

    async getAvailable(variantIds) {
      const result = new Map<string, number>();
      if (variantIds.length === 0) return result;
      const rows = await withTenantTransaction(db, (trx) =>
        trx
          .selectFrom("inventory.stock_level")
          .select(["variant_id", (eb) => eb.fn.sum<string>("available").as("available")])
          .where("variant_id", "in", [...variantIds])
          .groupBy("variant_id")
          .execute(),
      );
      for (const r of rows) result.set(r.variant_id, Number(r.available));
      return result;
    },
  };
}
