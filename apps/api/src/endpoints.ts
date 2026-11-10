// Setzt die Endpunkte aller Module zusammen (Architektur 6.1: apps/api setzt Module zusammen).
// Neue Module tragen sich hier ein. Die Reihenfolge spielt keine Rolle.
import { auditEndpoints } from "@shop/audit";
import { catalogEndpoints } from "@shop/catalog";
import type { Endpoint } from "@shop/http";
import {
  apiTokenEndpoints,
  authEndpoints,
  createApiTokenService,
  createMemberService,
  memberEndpoints,
  type ApiTokenService,
  type MemberService,
  type IdentityService,
  type ShopOfUser,
} from "@shop/identity";
import { createInventory } from "@shop/inventory";
import type { Database } from "@shop/kernel";
import { createMedia, memoryStorage, type Media } from "@shop/media";
import {
  createShopAdministration,
  platformEndpoints,
  type OperatorDirectory,
  type ShopAdministration,
} from "@shop/platform";
import { createPricing } from "@shop/pricing";

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
  /** Mitarbeiter (Modul identity). Ohne Angabe: über dieselbe Datenbank und das Anmeldemodul, ohne E-Mail. */
  readonly members?: MemberService;
  /** Shops verwalten (Modul platform, Verbindung als shop_platform). Ohne Angabe: Shops über dieselbe Datenbank. */
  readonly platformShops?: ShopAdministration;
  /** Bilder (Modul media). Ohne Angabe: Speicher im Arbeitsspeicher, Adressen unter media.localhost. */
  readonly media?: Media;
}

export function allEndpoints(deps: EndpointDependencies): Endpoint[] {
  const members =
    deps.members ??
    createMemberService({
      database: deps.database,
      identity: deps.identity ?? unconnectedIdentity,
      baseUrl: "https://admin.localhost",
    });
  const media =
    deps.media ??
    createMedia({
      database: deps.database,
      storage: memoryStorage(),
      publicBaseUrl: "https://media.localhost",
    });
  return [
    // Katalog mit Preisen, Bestand und Bildern aus den Modulen pricing, inventory und media (M2).
    ...catalogEndpoints({
      database: deps.database,
      prices: createPricing({ database: deps.database }),
      stock: createInventory({ database: deps.database }),
      images: {
        prepare: async (data, filename) => {
          const r = await media.prepareImage(data, filename);
          return r.ok ? { ok: true, save: () => media.saveImage(r.image) } : r;
        },
        get: (ids) => media.getImages(ids),
        remove: (ids) => media.deleteImages(ids),
      },
    }),
    ...auditEndpoints(deps),
    ...apiTokenEndpoints({ tokens: deps.tokens ?? createApiTokenService({ database: deps.database }) }),
    ...memberEndpoints({ members }),
    ...authEndpoints(
      deps.identity ?? unconnectedIdentity,
      deps.shopsOfUser === undefined ? {} : { shopsOfUser: deps.shopsOfUser },
    ),
    ...platformEndpoints({
      operators: deps.operators ?? { findOperator: async () => undefined },
      shops: deps.platformShops ?? createShopAdministration({ database: deps.database }),
      // Inhaberin eines neuen Shops einladen (M1): derselbe Ablauf wie bei Mitarbeitern, Rolle owner.
      inviteOwner: async ({ tenantId, email, invitedBy, locale }) => {
        const r = await members.invite({ tenantId, email, invitedBy, role: "owner", locale });
        if (r.ok)
          return { ok: true, invitationSent: r.invitationSent, invitationExpiresAt: r.invitationExpiresAt };
        if (r.reason === "invalid_email") return { ok: false, reason: "invalid_email" };
        throw new Error(`Einladung der Inhaberin gescheitert: ${r.reason}`);
      },
    }),
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
  requestPasswordReset: () => {
    throw new Error("Anmeldemodul ist nicht verbunden");
  },
  resetPassword: notConnected,
  prepareInvitee: notConnected,
  issueInvitationCode: notConnected,
  findInvitation: notConnected,
  redeemInvitation: notConnected,
  withdrawInvitation: notConnected,
  close: async () => undefined,
};
