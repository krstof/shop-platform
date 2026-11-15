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
  /**
   * Kennzahlen der Bestellungen eines Shops (Modul orders, zusammengesteckt in apps/api, läuft als
   * shop_app im Kontext genau dieses Shops). Ohne Angabe gibt es `GET /platform/v1/stats` nicht.
   */
  readonly shopStats?: (tenantId: string) => Promise<ShopOrderStats>;
}

/** Kennzahlen eines Shops wie in seinem Dashboard: letzte 7 Tage, zu versenden, Zahlung offen. */
export interface ShopOrderStats {
  readonly days: readonly { readonly date: string; readonly orders: number; readonly revenue: number }[];
  readonly toShip: number;
  readonly awaitingPayment: number;
}

/** Höchstens so viele Shops gehen in die Kennzahlen ein (Testplattform mit wenigen Shops). */
export const STATS_MAX_SHOPS = 200;

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

/**
 * Kurznamen, die als Seiten im Backoffice (`admin.<Domain>/<Kurzname>/…`) schon belegt sind (M8).
 * Ein Shop mit diesem Namen wäre dort nicht erreichbar; die API meldet sie wie vergebene Namen.
 */
export const RESERVED_SHOP_HANDLES: ReadonlySet<string> = new Set([
  "anmelden",
  "einladung",
  "passwort-neu",
  "passwort-vergessen",
  "plattform",
  "admin",
  "api",
  "auth",
  "platform",
]);

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
      "Kurzname schon vergeben oder für Seiten des Backoffice reserviert (etwa plattform): 409.",
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
      if (RESERVED_SHOP_HANDLES.has(body.handle.trim().toLowerCase()))
        throw new ConflictError({ detail: TEXTS.handleTaken[locale] });
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

  const endpoints = [me, list, create, changeStatus("suspended"), changeStatus("active")];
  if (options.shopStats !== undefined) endpoints.push(statsEndpoint(shops, options.shopStats));
  return endpoints;
}

const dayStats = z.object({
  date: z.iso.date().meta({ description: "Kalendertag in deutscher Zeit." }),
  orders: z.number().int().meta({ description: "Bezahlte Bestellungen an diesem Tag." }),
  revenue: z.number().int().meta({ description: "Umsatz brutto in Cent (bezahlte Bestellungen)." }),
});

const statsSchema = z
  .object({
    currency: z.literal("EUR"),
    shops: z.number().int().meta({ description: "Alle Shops außer gelöschten." }),
    activeShops: z.number().int().meta({ description: "Davon geöffnet." }),
    suspendedShops: z.number().int().meta({ description: "Davon gesperrt." }),
    days: z
      .array(dayStats)
      .meta({ description: "Die letzten 7 Tage bis heute, älteste zuerst, über alle Shops zusammen." }),
    toShip: z.number().int().meta({ description: "Bezahlt und noch nicht versendet, alle Shops." }),
    awaitingPayment: z.number().int().meta({ description: "Warten auf die Zahlung, alle Shops." }),
    perShop: z
      .array(
        z.object({
          id: z.uuid(),
          ordersToday: z.number().int(),
          revenueToday: z.number().int().meta({ description: "Cent." }),
          orders7d: z.number().int(),
          revenue7d: z.number().int().meta({ description: "Cent." }),
          toShip: z.number().int(),
        }),
      )
      .meta({ description: "Je Shop (Kennung wie in GET /shops), Reihenfolge wie dort." }),
    truncated: z
      .boolean()
      .meta({ description: `true: mehr als ${STATS_MAX_SHOPS} Shops, nur die ältesten sind eingerechnet.` }),
  })
  .meta({ id: "PlatformStats", description: "Kennzahlen aller Shops für die Plattform-Verwaltung." });

/** Kennzahlen aller Shops zusammenrechnen (rein, für Tests). */
export function combineStats(
  shopList: readonly Pick<ShopRecord, "id" | "status">[],
  stats: readonly ShopOrderStats[],
  truncated: boolean,
) {
  const days = new Map<string, { date: string; orders: number; revenue: number }>();
  let toShip = 0;
  let awaitingPayment = 0;
  const perShop = shopList.map((shop, i) => {
    const s = stats[i] ?? { days: [], toShip: 0, awaitingPayment: 0 };
    for (const d of s.days) {
      const day = days.get(d.date) ?? { date: d.date, orders: 0, revenue: 0 };
      day.orders += d.orders;
      day.revenue += d.revenue;
      days.set(d.date, day);
    }
    toShip += s.toShip;
    awaitingPayment += s.awaitingPayment;
    const today = s.days.at(-1);
    return {
      id: shop.id,
      ordersToday: today?.orders ?? 0,
      revenueToday: today?.revenue ?? 0,
      orders7d: s.days.reduce((n, d) => n + d.orders, 0),
      revenue7d: s.days.reduce((n, d) => n + d.revenue, 0),
      toShip: s.toShip,
    };
  });
  return {
    currency: "EUR" as const,
    shops: shopList.length,
    activeShops: shopList.filter((s) => s.status === "active").length,
    suspendedShops: shopList.filter((s) => s.status === "suspended").length,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    toShip,
    awaitingPayment,
    perShop,
    truncated,
  };
}

function statsEndpoint(
  shops: ShopAdministration,
  shopStats: (tenantId: string) => Promise<ShopOrderStats>,
): Endpoint {
  return defineEndpoint({
    api: "platform",
    method: "GET",
    path: "/stats",
    operationId: "getPlatformStats",
    summary: "Kennzahlen aller Shops",
    description:
      "Zahl der Shops, Umsatz und bezahlte Bestellungen je Tag der letzten 7 Tage (deutsche Zeit) über alle " +
      "Shops, offene Aufgaben (versenden, Zahlung offen) und dieselben Zahlen je Shop. Nur Summen, keine " +
      `Kundendaten. Höchstens ${STATS_MAX_SHOPS} Shops.`,
    tags: ["Plattform"],
    access: { scopes: ["platform:read"] },
    response: { status: 200, description: "Die Kennzahlen.", schema: statsSchema },
    handler: async () => {
      const rows = await shops.list({ limit: STATS_MAX_SHOPS });
      const truncated = rows.length > STATS_MAX_SHOPS;
      const included = rows.slice(0, STATS_MAX_SHOPS);
      // Je Shop eine eigene Abfrage im Kontext dieses Shops (Mandantentrennung bleibt), nacheinander,
      // damit wenige Verbindungen reichen.
      const stats: ShopOrderStats[] = [];
      for (const shop of included) stats.push(await shopStats(shop.id));
      return combineStats(included, stats, truncated);
    },
  });
}
