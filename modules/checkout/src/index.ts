// EINZIGE öffentliche Datei des Moduls checkout (Architektur 3.3, Regel 3).
// MVP-Etappe M6: Warenkorb, Kasse als Gast und Testzahlung in der Storefront-API. Das Modul
// verbindet die Fassaden von cart, catalog, inventory, orders, payments und shop-settings.
// Seit 15.11.2026 auch: Bestellung per Hand anlegen (Admin-API).
import type { Endpoint } from "@shop/http";
import { manualOrderEndpoints } from "./http/admin.js";
import { checkoutEndpoints as storeEndpoints, type CheckoutDependencies } from "./http/store.js";

export type { CheckoutDependencies } from "./http/store.js";
export { confirmationMail, type MailSender, type OutgoingMail } from "./mail.js";

export function checkoutEndpoints(deps: CheckoutDependencies): Endpoint[] {
  return [...storeEndpoints(deps), ...manualOrderEndpoints(deps)];
}
