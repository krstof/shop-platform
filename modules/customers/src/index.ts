// EINZIGE öffentliche Datei des Moduls customers (Architektur 3.3, Regel 3).
// Seit 15.11.2026: Kundenkarten per Hand anlegen, auflisten und löschen (Admin-API);
// Kontaktformular im Shop (Storefront-API) und Posteingang im Backoffice (Admin-API).
export {
  profileEndpoints as customerEndpoints,
  type ProfileDependencies as CustomersDependencies,
} from "./http/profiles.js";
export { contactEndpoints, type ContactDependencies } from "./http/contact.js";
