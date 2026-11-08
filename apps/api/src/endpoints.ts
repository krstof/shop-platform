// Setzt die Endpunkte aller Module zusammen (Architektur 6.1: apps/api setzt Module zusammen).
// Neue Module tragen sich hier ein. Die Reihenfolge spielt keine Rolle.
import { auditEndpoints } from "@shop/audit";
import { catalogEndpoints } from "@shop/catalog";
import type { Endpoint } from "@shop/http";
import {
  apiTokenEndpoints,
  authEndpoints,
  createApiTokenService,
  type ApiTokenService,
  type IdentityService,
  type ShopOfUser,
} from "@shop/identity";
import type { Database } from "@shop/kernel";
import { platformEndpoints, type OperatorDirectory } from "@shop/platform";

export interface EndpointDependencies {
  readonly database: Database<unknown>;
  /** Anmeldemodul. Ohne Angabe: ein Griff ohne Verbindung (nur OpenAPI und Tests ohne Anmeldung). */
  readonly identity?: IdentityService;
  /** Shops eines Kontos für „Wer bin ich“ (actor.ts, shopsOfUser). Ohne Angabe: keine Shops. */
  readonly shopsOfUser?: (userId: string) => Promise<readonly ShopOfUser[]>;
  /** Betreiberkonten (Modul platform). Ohne Angabe: niemand ist Betreiber. */
  readonly operators?: Pick<OperatorDirectory, "findOperator">;
  /** API-Token (Modul identity). Ohne Angabe: Token-Verwaltung über dieselbe Datenbank. */
  readonly tokens?: ApiTokenService;
}

export function allEndpoints(deps: EndpointDependencies): Endpoint[] {
  return [
    ...catalogEndpoints(deps),
    ...auditEndpoints(deps),
    ...apiTokenEndpoints({ tokens: deps.tokens ?? createApiTokenService({ database: deps.database }) }),
    ...authEndpoints(
      deps.identity ?? unconnectedIdentity,
      deps.shopsOfUser === undefined ? {} : { shopsOfUser: deps.shopsOfUser },
    ),
    ...platformEndpoints({ operators: deps.operators ?? { findOperator: async () => undefined } }),
  ];
}

/**
 * Griff ohne Verbindung, nur zum Erzeugen der OpenAPI-Dateien: Die Endpunkte werden beschrieben,
 * aber nie ausgeführt. Ein versehentlicher Datenbankzugriff würde sofort scheitern.
 */
export const unconnectedDatabase: Database<unknown> = { destroy: async () => undefined };

const notConnected = async (): Promise<never> => {
  throw new Error("Anmeldemodul ist nicht verbunden");
};

/** Anmeldemodul ohne Verbindung: Jeder Aufruf scheitert mit einem allgemeinen Fehler (500). */
export const unconnectedIdentity: IdentityService = {
  createUser: notConnected,
  signIn: notConnected,
  getSession: notConnected,
  signOut: notConnected,
  verifySecondFactor: notConnected,
  startTwoFactorSetup: notConnected,
  confirmTwoFactorSetup: notConnected,
  confirmPassword: notConnected,
  close: async () => undefined,
};
