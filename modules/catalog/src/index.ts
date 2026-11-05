// EINZIGE öffentliche Datei des Moduls catalog (Architektur 3.3, Regel 3).
// Andere Module und Programme importieren nur von hier: Fassade, Ereignistypen, DTOs, Endpunkte.
import type { Endpoint } from "@shop/http";
import type { Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { manufacturerEndpoints } from "./http/admin/manufacturers.js";

export type { Manufacturer } from "./http/admin/manufacturer.schema.js";
export { catalogEvents, manufacturerCreated, manufacturerUpdated } from "./catalog.events.js";

export interface CatalogDependencies {
  /** Verbindung als Rolle shop_app. Der Zugriff läuft ausschließlich über withTenantTransaction. */
  readonly database: Database<unknown>;
}

/** Alle HTTP-Endpunkte des Moduls. Das Programm api registriert sie; die Datenbank bleibt eingeschlossen. */
export function catalogEndpoints(deps: CatalogDependencies): Endpoint[] {
  // Der Griff ist derselbe für alle Module; die Typen des eigenen Schemas legt das Modul darüber.
  const db = deps.database as Database<DB>;
  return [...manufacturerEndpoints(db)];
}
