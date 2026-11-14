// Bestellungen im Backoffice (M7): Liste (neueste zuerst), Details, „versendet“.
import {
  decodeCursor,
  defineEndpoint,
  idParam,
  listQuery,
  multiLineText,
  pageOf,
  singleLineText,
  timestamp,
  toPage,
  type Endpoint,
} from "@shop/http";
import { ConflictError, NotFoundError } from "@shop/kernel";
import { z } from "zod";
import type { OrderRepository, OrderView } from "../internal/orders.js";

const status = z.enum(["pending_payment", "open", "in_progress", "completed", "cancelled"]).meta({
  description: "`pending_payment` wartet auf Zahlung, `open` bezahlt und offen, `completed` erledigt.",
});
const paymentStatus = z.enum(["unpaid", "authorized", "paid", "partially_refunded", "refunded", "failed"]);
const fulfillmentStatus = z.enum([
  "unfulfilled",
  "partially_shipped",
  "shipped",
  "delivered",
  "partially_returned",
  "returned",
]);

const summarySchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string(),
    placedAt: timestamp,
    customerName: z.string(),
    email: z.string(),
    total: z.number().int().meta({ description: "Gesamtbetrag brutto in Cent (EUR)." }),
    itemCount: z.number().int(),
    status,
    paymentStatus,
    fulfillmentStatus,
  })
  .meta({ id: "OrderSummary", description: "Bestellung in der Liste." });

const orderSchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string(),
    placedAt: timestamp,
    status,
    paymentStatus,
    fulfillmentStatus,
    email: z.string(),
    address: z.object({
      firstName: z.string(),
      lastName: z.string(),
      street: z.string(),
      postalCode: z.string(),
      city: z.string(),
      countryCode: z.string(),
    }),
    currency: z.string(),
    subtotal: z.number().int(),
    discount: z.number().int().meta({ description: "Rabatt durch Gutschein in Cent." }),
    couponCode: z.string().nullable(),
    shipping: z.number().int(),
    tax: z.number().int(),
    total: z.number().int(),
    taxByRate: z.record(z.string(), z.number().int()),
    paymentMethodName: z.string().nullable(),
    customerNote: z.string().nullable().meta({ description: "Anmerkung der Kundin aus der Kasse." }),
    merchantNote: z
      .string()
      .nullable()
      .meta({ description: "Interne Notiz des Shops, sieht die Kundin nie." }),
    lines: z.array(
      z.object({
        position: z.number().int(),
        productId: z.uuid(),
        name: z.string(),
        sku: z.string().nullable(),
        quantity: z.number().int(),
        unitPrice: z.number().int(),
        lineTotal: z.number().int(),
        taxRatePercent: z.number(),
      }),
    ),
  })
  .meta({ id: "Order", description: "Bestellung mit Positionen, Adresse und Summen (Momentaufnahme)." });

function toOrder(o: OrderView): z.input<typeof orderSchema> {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    placedAt: o.placedAt.toISOString(),
    status: o.status,
    paymentStatus: o.paymentStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    email: o.email,
    address: { ...o.address },
    customerNote: o.customerNote,
    merchantNote: o.merchantNote,
    currency: o.currency,
    subtotal: o.subtotal,
    discount: o.discount,
    couponCode: o.couponCode,
    shipping: o.shipping,
    tax: o.tax,
    total: o.total,
    taxByRate: { ...o.taxByRate },
    paymentMethodName: o.paymentMethodName,
    lines: o.lines.map((l) => ({
      position: l.position,
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      taxRatePercent: l.taxRatePercent,
    })),
  };
}

const cursorKey = z.strictObject({ id: z.uuid() });

const summaryResponse = z
  .object({
    currency: z.literal("EUR"),
    days: z
      .array(
        z.object({
          date: z.iso.date().meta({ description: "Kalendertag in deutscher Zeit." }),
          orders: z.number().int().meta({ description: "Bezahlte Bestellungen an diesem Tag." }),
          revenue: z.number().int().meta({ description: "Umsatz brutto in Cent (bezahlte Bestellungen)." }),
        }),
      )
      .meta({ description: "Die letzten 7 Tage bis heute, älteste zuerst, auch Tage ohne Bestellung." }),
    toShip: z.number().int().meta({ description: "Bezahlt und noch nicht versendet." }),
    awaitingPayment: z.number().int().meta({ description: "Warten auf die Zahlung." }),
  })
  .meta({ id: "OrderStats", description: "Kennzahlen für die Übersicht im Backoffice." });

/** Legt Ware zurück ins Lager (Modul inventory, zusammengesteckt in apps/api). */
export type Restock = (lines: { variantId: string; quantity: number }[], orderId: string) => Promise<void>;

export function orderAdminEndpoints(repo: OrderRepository, restock?: Restock): Endpoint[] {
  const stats = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/orders/summary",
    operationId: "getOrderStats",
    summary: "Kennzahlen der Bestellungen",
    description:
      "Umsatz und Zahl der bezahlten Bestellungen je Tag der letzten 7 Tage (deutsche Zeit), dazu wie " +
      "viele Bestellungen zu versenden sind und wie viele auf die Zahlung warten.",
    tags: ["Bestellungen"],
    access: { scopes: ["orders:read"] },
    response: { status: 200, description: "Die Kennzahlen.", schema: summaryResponse },
    handler: async () => {
      const r = await repo.summary(new Date(), 7);
      return { currency: "EUR" as const, ...r, days: [...r.days] };
    },
  });

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/orders",
    operationId: "listOrders",
    summary: "Bestellungen auflisten",
    description:
      "Bestellungen des Shops, neueste zuerst, seitenweise mit Cursor. Filter nach `status` möglich, `q` " +
      "sucht ohne Groß-/Kleinschreibung in Bestellnummer, E-Mail und Name der Kundin.",
    tags: ["Bestellungen"],
    access: { scopes: ["orders:read"] },
    query: listQuery({
      status: status.optional(),
      q: singleLineText(100)
        .optional()
        .meta({ description: "Suchtext für Bestellnummer, E-Mail oder Name." }),
    }),
    response: { status: 200, description: "Eine Seite mit Bestellungen.", schema: pageOf(summarySchema) },
    handler: async ({ query, locale }) => {
      const before =
        query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const rows = await repo.list({
        limit: query.limit,
        beforeId: before,
        status: query.status,
        search: query.q,
      });
      return toPage(
        rows,
        query.limit,
        (r) => ({ id: r.id }),
        (r) => ({ ...r, placedAt: r.placedAt.toISOString() }),
      );
    },
  });

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/orders/{orderId}",
    operationId: "getOrder",
    summary: "Bestellung lesen",
    description: "Eine Bestellung mit Positionen, Lieferadresse und Summen.",
    tags: ["Bestellungen"],
    access: { scopes: ["orders:read"] },
    params: z.strictObject({ orderId: idParam }),
    response: { status: 200, description: "Die Bestellung.", schema: orderSchema },
    problems: [404],
    handler: async ({ params }) => {
      const o = await repo.view(params.orderId);
      if (o === undefined) throw new NotFoundError();
      return toOrder(o);
    },
  });

  const ship = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/orders/{orderId}/ship",
    operationId: "shipOrder",
    summary: "Bestellung als versendet markieren",
    description:
      "Markiert eine bezahlte Bestellung als versendet; damit ist sie erledigt. Nicht bezahlte oder " +
      "schon versendete Bestellungen ergeben 409.",
    tags: ["Bestellungen"],
    access: { scopes: ["orders:write"] },
    params: z.strictObject({ orderId: idParam }),
    response: { status: 200, description: "Die Bestellung danach.", schema: orderSchema },
    problems: [404, 409],
    handler: async ({ params }) => {
      const r = await repo.markShipped(params.orderId);
      if (r.kind === "ok") return toOrder(r.order);
      if (r.kind === "not_found") throw new NotFoundError();
      throw new ConflictError({
        detail: "Nur bezahlte, noch nicht versendete Bestellungen lassen sich versenden.",
      });
    },
  });

  const cancel = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/orders/{orderId}/cancel",
    operationId: "cancelOrder",
    summary: "Bestellung stornieren",
    description:
      "Storniert eine noch nicht versendete Bestellung und legt die Ware zurück ins Lager. War sie bezahlt, " +
      "gilt die (Test-)Zahlung als erstattet. Schon versendete oder stornierte Bestellungen ergeben 409.",
    tags: ["Bestellungen"],
    access: { scopes: ["orders:write"] },
    params: z.strictObject({ orderId: idParam }),
    response: { status: 200, description: "Die Bestellung danach.", schema: orderSchema },
    problems: [404, 409],
    handler: async ({ params }) => {
      const r = await repo.cancel(params.orderId, (lines) =>
        restock === undefined || lines.length === 0 ? Promise.resolve() : restock(lines, params.orderId),
      );
      if (r.kind === "ok") return toOrder(r.order);
      if (r.kind === "not_found") throw new NotFoundError();
      throw new ConflictError({
        detail: "Nur noch nicht versendete Bestellungen lassen sich stornieren.",
      });
    },
  });

  const note = defineEndpoint({
    api: "admin",
    method: "PUT",
    path: "/orders/{orderId}/note",
    operationId: "setOrderNote",
    summary: "Interne Notiz setzen",
    description: "Setzt die interne Notiz einer Bestellung (sieht nur der Shop). `null` löscht sie.",
    tags: ["Bestellungen"],
    access: { scopes: ["orders:write"] },
    params: z.strictObject({ orderId: idParam }),
    body: z.strictObject({ note: multiLineText(2000).nullable() }),
    bodyExample: { note: "Kundin hat angerufen: bitte als Geschenk verpacken." },
    response: { status: 200, description: "Die Bestellung danach.", schema: orderSchema },
    problems: [404],
    handler: async ({ params, body }) => {
      const o = await repo.setMerchantNote(params.orderId, body.note);
      if (o === undefined) throw new NotFoundError();
      return toOrder(o);
    },
  });

  const customers = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/customers",
    operationId: "listCustomers",
    summary: "Kundinnen und Kunden",
    description:
      "Alle, die im Shop bestellt haben, je E-Mail-Adresse zusammengefasst (Gäste haben kein Konto): Name " +
      "aus der neuesten Bestellung, Zahl der Bestellungen ohne stornierte, Umsatz aus bezahlten " +
      "Bestellungen, erste und letzte Bestellung. Zuletzt bestellende zuerst, aus den letzten 5000 Bestellungen.",
    tags: ["Kunden"],
    access: { scopes: ["customers:read", "orders:read"] },
    response: {
      status: 200,
      description: "Die Kundinnen und Kunden.",
      schema: z.object({
        data: z.array(
          z
            .object({
              email: z.string(),
              name: z.string(),
              orderCount: z.number().int(),
              revenue: z.number().int().meta({ description: "Summe bezahlter Bestellungen in Cent." }),
              firstOrderAt: timestamp,
              lastOrderAt: timestamp,
            })
            .meta({ id: "CustomerSummary" }),
        ),
      }),
    },
    handler: async () => ({
      data: (await repo.customers()).map((c) => ({
        ...c,
        firstOrderAt: c.firstOrderAt.toISOString(),
        lastOrderAt: c.lastOrderAt.toISOString(),
      })),
    }),
  });

  return [stats, list, get, ship, cancel, note, customers];
}
