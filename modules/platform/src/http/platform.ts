// Endpunkte der Platform-API (Architektur 4.3). Erreichbar nur für aktive Betreiberkonten mit
// bestätigtem zweitem Faktor (apps/api, actor.ts) und nie mit einem Shop. „Wer bin ich als
// Betreiber“ (E6 Teil 4) und Shops verwalten (M1): auflisten, anlegen mit Einladung der Inhaberin,
// sperren und wieder freischalten.
import {
  decodeCursor,
  defineEndpoint,
  idParam,
  listQuery,
  pageOf,
  timestamp,
  toPage,
  type Endpoint,
} from "@shop/http";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Locale } from "@shop/kernel";
import { z } from "zod";
import { OPERATOR_ROLES, type OperatorDirectory } from "../internal/operators.js";
import { SHOP_HANDLE_PATTERN, type ShopAdministration, type ShopRecord } from "../internal/shop-admin.js";
import { TENANT_STATUSES } from "../internal/shops.js";

/** Ergebnis der Einladung der Inhaberin (setzt apps/api mit dem Modul identity zusammen). */
export type OwnerInvitationResult =
  | { readonly ok: true; readonly invitationSent: boolean; readonly invitationExpiresAt: Date }
  | { readonly ok: false; readonly reason: "invalid_email" };

export interface PlatformEndpointOptions {
  readonly operators: Pick<OperatorDirectory, "findOperator">;
  /** Shops verwalten (Verbindung als shop_platform). Ohne Angabe gibt es die Shop-Endpunkte nicht. */
  readonly shops?: ShopAdministration;
  /** Lädt die Inhaberin eines neuen Shops ein (Modul identity). */
  readonly inviteOwner?: (input: {
    readonly tenantId: string;
    readonly email: string;
    readonly invitedBy: string;
    readonly locale: Locale;
  }) => Promise<OwnerInvitationResult>;
}

const shopSchema = z
  .object({
    id: z.uuid(),
    handle: z.string().describe("Kurzname, Teil der Shop-Adresse (etwa teeladen.localhost)."),
    name: z.string(),
    status: z
      .enum(TENANT_STATUSES)
      .describe("active: geöffnet. suspended: gesperrt, niemand vom Shop kann sich dort anmelden."),
    ownerEmail: z.string().nullable().describe("E-Mail-Adresse der Inhaberin beim Anlegen."),
    createdAt: timestamp,
  })
  .meta({ id: "PlatformShop", description: "Ein Shop aus Sicht der Plattform-Verwaltung." });

const createdShopSchema = shopSchema
  .extend({
    invitationSent: z
      .boolean()
      .describe(
        "false: Die Einladung an die Inhaberin ging nicht hinaus. Später im Backoffice erneut einladen.",
      ),
    invitationExpiresAt: timestamp.nullable().describe("Bis dann gilt der Link in der Einladung."),
  })
  .meta({ id: "CreatedPlatformShop" });

function toShop(r: ShopRecord) {
  return {
    id: r.id,
    handle: r.handle,
    name: r.name,
    status: r.status,
    ownerEmail: r.ownerEmail,
    createdAt: r.createdAt.toISOString(),
  };
}

const TEXTS = {
  handleTaken: {
    de: "Diesen Kurznamen hat schon ein anderer Shop.",
    en: "Another shop already uses this handle.",
  },
  invalidEmail: { de: "Keine gültige E-Mail-Adresse.", en: "Not a valid email address." },
} as const satisfies Record<string, Record<Locale, string>>;

const cursorKey = z.strictObject({ id: z.uuid() });

const operatorSchema = z
  .object({
    userId: z.uuid(),
    role: z
      .enum(OPERATOR_ROLES)
      .describe(
        "owner: Inhaber der Plattform, operator: Betrieb, support: Hilfe für Händler, viewer: nur lesen.",
      ),
  })
  .meta({ id: "PlatformOperator" });

export function platformEndpoints(options: PlatformEndpointOptions): Endpoint[] {
  const me = defineEndpoint({
    api: "platform",
    method: "GET",
    path: "/operator",
    operationId: "getPlatformOperator",
    summary: "Wer bin ich als Betreiber",
    description:
      "Liefert das Betreiberkonto der Sitzung und seine Rolle. Nur mit bestätigtem zweitem Faktor; " +
      "ohne Zwei-Faktor oder ohne Betreiberkonto 403. Die Sitzung endet nach 1 Stunde ohne Aktivität, " +
      "spätestens 12 Stunden nach der Anmeldung.",
    tags: ["Plattform"],
    access: { scopes: ["platform:read"] },
    response: { status: 200, description: "Betreiberkonto.", schema: operatorSchema },
    handler: async ({ auth }) => {
      const userId = auth?.actor.type === "user" ? auth.actor.id : undefined;
      const operator = userId === undefined ? undefined : await options.operators.findOperator(userId);
      if (operator === undefined) throw new ForbiddenError();
      return { userId: operator.userId, role: operator.role };
    },
  });
  const { shops, inviteOwner } = options;
  if (shops === undefined) return [me];
  const operatorOf = (auth: { actor: { type: string; id?: string | undefined } } | undefined): string => {
    const id = auth?.actor.type === "user" ? auth.actor.id : undefined;
    if (id === undefined) throw new ForbiddenError();
    return id;
  };

  const list = defineEndpoint({
    api: "platform",
    method: "GET",
    path: "/shops",
    operationId: "listPlatformShops",
    summary: "Shops auflisten",
    description: "Listet alle Shops der Plattform mit Zustand, älteste zuerst. Gelöschte fehlen.",
    tags: ["Plattform"],
    access: { scopes: ["platform:read"] },
    query: listQuery(),
    response: { status: 200, description: "Eine Seite mit Shops.", schema: pageOf(shopSchema) },
    handler: async ({ query, locale }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const rows = await shops.list({
        limit: query.limit,
        ...(after === undefined ? {} : { afterId: after }),
      });
      return toPage(rows, query.limit, (r) => ({ id: r.id }), toShop);
    },
  });

  const create = defineEndpoint({
    api: "platform",
    method: "POST",
    path: "/shops",
    operationId: "createPlatformShop",
    summary: "Shop anlegen",
    description:
      "Legt einen Shop an, der sofort geöffnet ist, und lädt die Inhaberin per E-Mail ein. Mit dem Link " +
      "wählt sie ihr Passwort (gibt es das Konto schon, bleibt es) und kommt danach ins Backoffice. " +
      "Kurzname schon vergeben: 409.",
    tags: ["Plattform"],
    access: { scopes: ["platform:write"] },
    body: z.strictObject({
      handle: z
        .string()
        .regex(SHOP_HANDLE_PATTERN)
        .describe("Kurzname: Kleinbuchstaben, Ziffern und Bindestriche, 3 bis 63 Zeichen."),
      name: z.string().trim().min(1).max(100).describe("Name des Shops, wie Kundinnen ihn sehen."),
      ownerEmail: z.string().min(3).max(320).describe("E-Mail-Adresse der Inhaberin oder des Inhabers."),
    }),
    bodyExample: { handle: "teeladen", name: "Teeladen", ownerEmail: "inhaberin@teeladen.example" },
    response: { status: 201, description: "Angelegt.", schema: createdShopSchema },
    problems: [409],
    handler: async ({ body, auth, locale }) => {
      const operatorId = operatorOf(auth);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.ownerEmail.trim()))
        throw new ValidationError({
          errors: [{ path: "/body/ownerEmail", code: "invalid_email", message: TEXTS.invalidEmail[locale] }],
        });
      const created = await shops.create({ ...body, actorId: operatorId });
      if (!created.ok) throw new ConflictError({ detail: TEXTS.handleTaken[locale] });
      const invitation =
        inviteOwner === undefined
          ? undefined
          : await inviteOwner({
              tenantId: created.shop.id,
              email: body.ownerEmail,
              invitedBy: operatorId,
              locale,
            });
      const ok = invitation?.ok === true ? invitation : undefined;
      return {
        ...toShop(created.shop),
        invitationSent: ok?.invitationSent ?? false,
        invitationExpiresAt: ok?.invitationExpiresAt.toISOString() ?? null,
      };
    },
  });

  const changeStatus = (status: "active" | "suspended") =>
    defineEndpoint({
      api: "platform",
      method: "POST",
      path: status === "suspended" ? "/shops/{shopId}/suspend" : "/shops/{shopId}/reactivate",
      operationId: status === "suspended" ? "suspendPlatformShop" : "reactivatePlatformShop",
      summary: status === "suspended" ? "Shop sperren" : "Shop wieder freischalten",
      description:
        status === "suspended"
          ? "Sperrt einen Shop sofort: Inhaberin, Mitarbeiter und API-Token kommen bei der nächsten Anfrage " +
            "nicht mehr hinein. Daten bleiben erhalten. Schon gesperrt: keine Änderung."
          : "Öffnet einen gesperrten Shop wieder. Schon geöffnet: keine Änderung.",
      tags: ["Plattform"],
      access: { scopes: ["platform:write"] },
      params: z.strictObject({ shopId: idParam }),
      response: { status: 200, description: "Neuer Zustand.", schema: shopSchema },
      problems: [404],
      handler: async ({ params, auth }) => {
        const result = await shops.setStatus({ id: params.shopId, status, actorId: operatorOf(auth) });
        if (!result.ok) throw new NotFoundError();
        return toShop(result.shop);
      },
    });

  return [me, list, create, changeStatus("suspended"), changeStatus("active")];
}
