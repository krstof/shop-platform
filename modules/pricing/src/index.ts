// EINZIGE öffentliche Datei des Moduls pricing (Architektur 3.3, Regel 3).
// MVP-Etappe M2: ein Grundpreis je Variante (brutto, eine Währung, ohne Kanal und Kundengruppe).
// Läuft ein Aufrufer schon in einer Transaktion für denselben Shop, schreibt die Fassade darin mit
// (withTenantTransaction, Architektur 3.5 Weg 1). Jede Änderung landet per Trigger im Preisverlauf.
import { getContext, withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";

export interface PricingDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
}

export interface BasePrice {
  readonly variantId: string;
  /** Bruttobetrag in Cent (ADR-006). */
  readonly amount: number;
  readonly currency: string;
}

export interface Pricing {
  /** Setzt den Grundpreis einer Variante. Gleicher Betrag: keine Änderung, kein Eintrag im Verlauf. */
  setBasePrice(price: BasePrice): Promise<void>;
  /** Grundpreise der Varianten in einer Währung. Varianten ohne Preis fehlen in der Antwort. */
  getBasePrices(variantIds: readonly string[], currency: string): Promise<Map<string, number>>;
}

export function createPricing(deps: PricingDependencies): Pricing {
  const db = deps.database as Database<DB>;
  return {
    async setBasePrice({ variantId, amount, currency }) {
      if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Preis muss ganze Cent ≥ 0 sein");
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, (trx) =>
        trx
          .insertInto("pricing.price")
          .values({
            tenant_id: tenantId,
            variant_id: variantId,
            kind: "base",
            currency,
            amount,
            tax_included: true,
          })
          .onConflict((oc) =>
            oc
              .constraint("price_scope_unique")
              .doUpdateSet({ amount: (eb) => eb.ref("excluded.amount"), tax_included: true })
              .where("pricing.price.amount", "is distinct from", (eb) => eb.ref("excluded.amount")),
          )
          .execute(),
      );
    },

    async getBasePrices(variantIds, currency) {
      const result = new Map<string, number>();
      if (variantIds.length === 0) return result;
      const rows = await withTenantTransaction(db, (trx) =>
        trx
          .selectFrom("pricing.price")
          .select(["variant_id", "amount"])
          .where("variant_id", "in", [...variantIds])
          .where("kind", "=", "base")
          .where("currency", "=", currency)
          .where("channel_id", "is", null)
          .where("customer_group_id", "is", null)
          .where("country_code", "is", null)
          .where("min_quantity", "=", 1)
          .where("valid_from", "is", null)
          .execute(),
      );
      for (const r of rows) result.set(r.variant_id, Number(r.amount));
      return result;
    },
  };
}
