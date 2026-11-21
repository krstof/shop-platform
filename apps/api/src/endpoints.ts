// Setzt die Endpunkte aller Module zusammen (Architektur 6.1: apps/api setzt Module zusammen).
// Neue Module tragen sich hier ein. Die Reihenfolge spielt keine Rolle.
import { aiEndpoints, type AssistantModel } from "@shop/ai";
import { auditEndpoints } from "@shop/audit";
import { createCarts } from "@shop/cart";
import { catalogEndpoints, createCatalogReader, type ProductImages } from "@shop/catalog";
import { checkoutEndpoints, type MailSender } from "@shop/checkout";
import { contactEndpoints, customerEndpoints } from "@shop/customers";
import type { Endpoint } from "@shop/http";
import {
  apiTokenEndpoints,
  deviceEndpoints,
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
import { randomBytes } from "node:crypto";
import {
  createSecretBox,
  getContext,
  runWithContext,
  type Database,
  type Logger,
  type SecretBox,
} from "@shop/kernel";
import { createMedia, memoryStorage, type Media } from "@shop/media";
import {
  createShopAdministration,
  createShopDirectory,
  platformEndpoints,
  storeShopEndpoints,
  type OperatorDirectory,
  type ShopAdministration,
} from "@shop/platform";
import { createOrders, orderEndpoints } from "@shop/orders";
import { createPayments } from "@shop/payments";
import { couponEndpoints, createPricing } from "@shop/pricing";
import { createIntegrations, integrationEndpoints } from "@shop/integrations";
import { createShopSettings, generalSettingsEndpoints } from "@shop/shop-settings";
import { createShipping, shippingEndpoints } from "@shop/shipping";
import { storefrontEndpoints } from "@shop/storefront-design";

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
  /** E-Mails an Kundinnen und Kunden (Bestellbestätigung, M6). Ohne Angabe: keine E-Mail. */
  readonly mailer?: MailSender;
  /** Adresse der Shops für Links in E-Mails, etwa https://shop.example.org. Ohne Angabe: kein Link. */
  readonly storefrontBaseUrl?: string | undefined;
  readonly logger?: Logger;
  /** Sprachmodell des KI-Assistenten (Welle 2). Ohne Angabe: „nicht eingerichtet“. */
  readonly assistantModel?: AssistantModel | undefined;
  /** Antworten des Assistenten je Shop und Tag. */
  readonly assistantDailyLimit?: number | undefined;
  /**
   * Verschlüsselung der Zugangsdaten für Anbindungen (21.11.2026). Ohne Angabe ein Zufallsschlüssel
   * nur im Arbeitsspeicher: gut für Tests, im Betrieb reicht apps/api/src/main.ts den echten herein.
   */
  readonly secretBox?: SecretBox | undefined;
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
  // Anbindungen (21.11.2026): Zugangsdaten je Shop, verschlüsselt mit dem Hauptschlüssel.
  const secretBox = deps.secretBox ?? createSecretBox(new Map([[1, randomBytes(32)]]));
  const integrations = createIntegrations({ database: deps.database, secretBox });
  const prices = createPricing({ database: deps.database });
  const stock = createInventory({ database: deps.database });
  const images: ProductImages = {
    prepare: async (data, filename) => {
      const r = await media.prepareImage(data, filename);
      return r.ok ? { ok: true, save: () => media.saveImage(r.image) } : r;
    },
    get: (ids) => media.getImages(ids),
    remove: (ids) => media.deleteImages(ids),
  };
  const settings = createShopSettings({ database: deps.database });
  const shops = createShopDirectory({ database: deps.database });
  const platformOrders = createOrders({ database: deps.database, settings });
  return [
    // Katalog mit Preisen, Bestand und Bildern aus den Modulen pricing, inventory und media (M2).
    ...catalogEndpoints({ database: deps.database, prices, stock, images }),
    // Bestellungen im Backoffice (M7).
    ...orderEndpoints({
      database: deps.database,
      settings,
      restock: (lines, id) => stock.putBack(lines, id),
    }),
    // Kaufen in der Storefront (M6): Warenkorb, Kasse, Testzahlung, Bestellbestätigung.
    ...customerEndpoints({ database: deps.database }),
    // Kontaktformular im Shop und Posteingang im Backoffice.
    ...contactEndpoints({
      database: deps.database,
      onMessage: async (m) => {
        const subject = m.subject === "" ? "ohne Betreff" : m.subject;
        await integrations.notifyMerchant(`Neue Nachricht von ${m.name}: ${subject}`);
      },
    }),
    ...checkoutEndpoints({
      database: deps.database,
      carts: createCarts({ database: deps.database }),
      catalog: createCatalogReader({ database: deps.database, prices, stock, images }),
      shipping: createShipping({ database: deps.database }),
      coupons: prices,
      inventory: stock,
      orders: createOrders({ database: deps.database, settings }),
      payments: createPayments({ database: deps.database }),
      settings,
      mailer: deps.mailer,
      ...(deps.storefrontBaseUrl === undefined
        ? {}
        : {
            orderLink: (handle: string, paymentToken: string) =>
              `${deps.storefrontBaseUrl}/${handle}/bestellung/${paymentToken}`,
          }),
      shopName: async () => (await shops.getShops([getContext()?.tenantId ?? ""]))[0]?.name,
      onMailError: (error) =>
        deps.logger?.error({ err: error }, "Bestellbestätigung konnte nicht verschickt werden"),
      onOrderPaid: async (order) => {
        const euro = (order.total / 100).toFixed(2).replace(".", ",");
        const artikel = order.lines === 1 ? "1 Artikel" : `${order.lines} Artikel`;
        await integrations.notifyMerchant(`Neue Bestellung ${order.orderNumber}: ${euro} € (${artikel})`);
      },
    }),
    ...storeShopEndpoints(shops),
    // Anbindungen an fremde Dienste: Telegram und was später dazukommt.
    ...integrationEndpoints({ database: deps.database, secretBox }),
    // Einstellungen „Allgemein“: Adresse, Geschäftsangaben, Shop geöffnet, Shop-Name (Name in platform).
    ...generalSettingsEndpoints({
      database: deps.database,
      shopName: async () => (await shops.getShops([getContext()?.tenantId ?? ""]))[0]?.name ?? "",
      renameShop: async (name) => {
        const admin = deps.platformShops ?? createShopAdministration({ database: deps.database });
        const actor = getContext()?.actor;
        await admin.rename({
          id: getContext()?.tenantId ?? "",
          name,
          ...(actor?.type === "user" && actor.id !== undefined ? { actorId: actor.id } : {}),
        });
      },
    }),
    // Aussehen des Shops (Shop-Editor Teil 1): Farbe, Schrift, Logo; dieselben Bildfunktionen.
    ...storefrontEndpoints({ database: deps.database, images }),
    // Gutscheincodes (Modul pricing).
    ...couponEndpoints({ database: deps.database }),
    // Versandkosten (Pauschale, kostenlos ab Warenwert).
    ...shippingEndpoints({ database: deps.database }),
    ...auditEndpoints(deps),
    // KI-Assistent (Welle 2): Übergang zum Sprachmodell, Werkzeuge laufen im Backoffice.
    ...aiEndpoints({
      database: deps.database,
      model: deps.assistantModel,
      dailyLimit: deps.assistantDailyLimit,
      onModelError: (error) =>
        deps.logger?.error({ err: error }, "Sprachmodell des Assistenten antwortet nicht"),
    }),
    ...apiTokenEndpoints({ tokens: deps.tokens ?? createApiTokenService({ database: deps.database }) }),
    ...deviceEndpoints({
      identity: deps.identity ?? unconnectedIdentity,
      tokens: deps.tokens ?? createApiTokenService({ database: deps.database }),
      shopName: async (tenantId) => (await shops.getShops([tenantId]))[0]?.name,
    }),
    ...memberEndpoints({ members }),
    ...authEndpoints(deps.identity ?? unconnectedIdentity, {
      ...(deps.shopsOfUser === undefined ? {} : { shopsOfUser: deps.shopsOfUser }),
      // Betreiberkonto? Für die Plattform-Verwaltung im Backoffice (M8).
      ...(deps.operators === undefined
        ? {}
        : {
            isPlatformOperator: async (userId: string) =>
              (await deps.operators?.findOperator(userId)) !== undefined,
          }),
    }),
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
      // Plattform-Kennzahlen: je Shop dieselbe Abfrage wie im Dashboard, als shop_app im Kontext genau
      // dieses Shops (RLS wie immer). Die Plattform-API selbst sieht nie Bestellungen.
      shopStats: (tenantId) => {
        const context = getContext();
        return runWithContext(
          { ...context, requestId: context?.requestId ?? "platform-stats", tenantId },
          () => platformOrders.summary(new Date(), 7),
        );
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
  setPasswordForTestData: notConnected,
  prepareInvitee: notConnected,
  issueInvitationCode: notConnected,
  issueDevicePairingCode: notConnected,
  claimDevicePairingCode: notConnected,
  findInvitation: notConnected,
  redeemInvitation: notConnected,
  withdrawInvitation: notConnected,
  close: async () => undefined,
};
