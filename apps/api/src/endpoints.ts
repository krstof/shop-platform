// Setzt die Endpunkte aller Module zusammen (Architektur 6.1: apps/api setzt Module zusammen).
// Neue Module tragen sich hier ein. Die Reihenfolge spielt keine Rolle.
import { catalogEndpoints } from "@shop/catalog";
import type { Endpoint } from "@shop/http";
import type { Database } from "@shop/kernel";

export interface EndpointDependencies {
  readonly database: Database<unknown>;
}

export function allEndpoints(deps: EndpointDependencies): Endpoint[] {
  return [...catalogEndpoints(deps)];
}

/**
 * Griff ohne Verbindung, nur zum Erzeugen der OpenAPI-Dateien: Die Endpunkte werden beschrieben,
 * aber nie ausgeführt. Ein versehentlicher Datenbankzugriff würde sofort scheitern.
 */
export const unconnectedDatabase: Database<unknown> = { destroy: async () => undefined };
