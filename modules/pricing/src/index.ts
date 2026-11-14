// EINZIGE öffentliche Datei des Moduls pricing (Architektur 3.3, Regel 3).
// MVP-Etappe M2: ein Grundpreis je Variante (brutto, eine Währung, ohne Kanal und Kundengruppe),
// dazu wahlweise ein Angebotspreis (`sale`, ohne Zeitraum).
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
  /** Setzt den Angebotspreis (`kind = sale`, ohne Zeitraum); `null` entfernt ihn. */
  setSalePrice(variantId: string, amount: number | null, currency: string): Promise<void>;
  /** Angebotspreise der Varianten; Varianten ohne Angebot fehlen in der Antwort. */
  getSalePrices(variantIds: readonly string[], currency: string): Promise<Map<string, number>>;
}

export function createPricing(deps: PricingDependencies): Pricing {
  const db = deps.database as Database<DB>;
  return {
    async setBasePrice({ variantId, amount, currency }) {
      await upsert(variantId, "base", amount, currency);
    },

    async setSalePrice(variantId, amount, currency) {
      if (amount === null) {
        await withTenantTransaction(db, (trx) =>
          trx
            .deleteFrom("pricing.price")
            .where("variant_id", "=", variantId)
            .where("kind", "=", "sale")
            .where("currency", "=", currency)
            .where("channel_id", "is", null)
            .where("customer_group_id", "is", null)
            .where("country_code", "is", null)
            .where("min_quantity", "=", 1)
            .where("valid_from", "is", null)
            .execute(),
        );
        return;
      }
      await upsert(variantId, "sale", amount, currency);
    },

    async getBasePrices(variantIds, currency) {
      return read(variantIds, "base", currency);
    },

    async getSalePrices(variantIds, currency) {
      return read(variantIds, "sale", currency);
    },
  };

  async function upsert(
    variantId: string,
    kind: "base" | "sale",
    amount: number,
    currency: string,
  ): Promise<void> {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Preis muss ganze Cent ≥ 0 sein");
    const tenantId = getContext()?.tenantId ?? "";
    await withTenantTransaction(db, (trx) =>
      trx
        .insertInto("pricing.price")
        .values({
          tenant_id: tenantId,
          variant_id: variantId,
          kind,
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
  }

  async function read(
    variantIds: readonly string[],
    kind: "base" | "sale",
    currency: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (variantIds.length === 0) return result;
    const rows = await withTenantTransaction(db, (trx) =>
      trx
        .selectFrom("pricing.price")
        .select(["variant_id", "amount"])
        .where("variant_id", "in", [...variantIds])
        .where("kind", "=", kind)
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
  }
}
