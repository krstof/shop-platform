// EINZIGE öffentliche Datei des Moduls shipping (Architektur 3.3, Regel 3).
// Einfachste Form: Standardversand mit Pauschale, wahlweise kostenlos ab einem Warenwert.
import { withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { quoteFor, type ShippingQuote } from "./internal/rules.js";
import { readStandard } from "./internal/standard.js";

export { shippingEndpoints } from "./http/shipping.js";
export { quoteFor, type ShippingQuote, type StandardShipping } from "./internal/rules.js";

export interface Shipping {
  /** Versandkosten für einen Warenwert (brutto, Cent) im aktuellen Shop. */
  quote(subtotal: number): Promise<ShippingQuote>;
}

export function createShipping(deps: { readonly database: Database<unknown> }): Shipping {
  const db = deps.database as Database<DB>;
  return {
    async quote(subtotal) {
      return quoteFor(subtotal, await withTenantTransaction(db, readStandard));
    },
  };
}
