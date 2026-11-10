// EINZIGE öffentliche Datei des Moduls checkout (Architektur 3.3, Regel 3).
// MVP-Etappe M6: Warenkorb, Kasse als Gast und Testzahlung in der Storefront-API. Das Modul
// verbindet die Fassaden von cart, catalog, inventory, orders, payments und shop-settings.
export { checkoutEndpoints, type CheckoutDependencies } from "./http/store.js";
export { confirmationMail, type MailSender, type OutgoingMail } from "./mail.js";
