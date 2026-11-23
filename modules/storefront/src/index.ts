// EINZIGE öffentliche Datei des Moduls storefront (Architektur 3.3, Regel 3).
// Shop-Editor Teil 1: Aussehen (Hauptfarbe, Schrift, Logo) mit Entwurf und Veröffentlichung.
// Vorlagen und Seitenaufbau (template, template_version) folgen mit späteren Teilen des Editors.
import type { Endpoint } from "@shop/http";
import type { Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { designEndpoints, type DesignImages } from "./http/design.js";
import { viewEndpoints } from "./http/views.js";

export type { DesignImage, DesignImages, ImageRejection } from "./http/design.js";
export { FONTS, type Font } from "./internal/design.js";

export interface StorefrontDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  /** Bilder fürs Logo (Modul media, zusammengesteckt in apps/api). */
  readonly images: DesignImages;
}

/**
 * Alle HTTP-Endpunkte des Moduls: Aussehen bearbeiten und lesen, dazu seit Paket P3 die
 * Seitenaufrufe (melden aus der Storefront, auswerten im Backoffice).
 */
export function storefrontEndpoints(deps: StorefrontDependencies): Endpoint[] {
  return [
    ...designEndpoints({ db: deps.database as Database<DB>, images: deps.images }),
    ...viewEndpoints(deps.database as Database<DB>),
  ];
}
