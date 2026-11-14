// EINZIGE öffentliche Datei des Moduls shop-settings (Architektur 3.3, Regel 3).
// MVP-Etappe M6: Verkaufskanal „Storefront“ und Nummernkreis für Bestellungen. Beides legt die
// Fassade beim ersten Bedarf selbst an (Shops aus M1 haben es noch nicht). Läuft in der
// Transaktion des Aufrufers mit (withTenantTransaction, Architektur 3.5).
import { getContext, withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";

export { COUNTRIES, generalSettingsEndpoints, type GeneralSettingsDependencies } from "./http/general.js";

export interface ShopSettingsDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
}

export interface ShopSettings {
  /** Kennung des Standard-Verkaufskanals „Storefront“. */
  storefrontChannelId(): Promise<string>;
  /** Nächste Bestellnummer, lückenlos je Shop (Zeile bleibt bis zum Ende der Transaktion gesperrt). */
  nextOrderNumber(): Promise<string>;
}

export function createShopSettings(deps: ShopSettingsDependencies): ShopSettings {
  const db = deps.database as Database<DB>;
  const tenant = () => getContext()?.tenantId ?? "";
  return {
    async storefrontChannelId() {
      return withTenantTransaction(db, async (trx) => {
        const found = await trx
          .selectFrom("shop_settings.sales_channel")
          .select("id")
          .where("kind", "=", "storefront")
          .orderBy("is_default", "desc")
          .executeTakeFirst();
        if (found !== undefined) return found.id;
        const created = await trx
          .insertInto("shop_settings.sales_channel")
          .values({
            tenant_id: tenant(),
            code: "storefront",
            kind: "storefront",
            name: "Storefront",
            is_default: true,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return created.id;
      });
    },

    async nextOrderNumber() {
      return withTenantTransaction(db, async (trx) => {
        // Nummernkreis beim ersten Mal anlegen: Bestellungen beginnen bei 10001.
        await trx
          .insertInto("shop_settings.number_range")
          .values({
            tenant_id: tenant(),
            kind: "order",
            min_digits: 5,
            start_value: 10001,
            next_value: 10001,
          })
          .onConflict((oc) => oc.columns(["tenant_id", "kind"]).doNothing())
          .execute();
        const r = await trx
          .selectNoFrom((eb) => eb.fn<string>("shop_settings.next_number", [eb.val("order")]).as("n"))
          .executeTakeFirstOrThrow();
        return r.n;
      });
    },
  };
}
