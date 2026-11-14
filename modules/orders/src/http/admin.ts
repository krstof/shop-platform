// Bestellungen im Backoffice (M7): Liste (neueste zuerst), Details, „versendet“.
import {
  decodeCursor,
  defineEndpoint,
  idParam,
  listQuery,
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
    shipping: z.number().int(),
    tax: z.number().int(),
    total: z.number().int(),
    taxByRate: z.record(z.string(), z.number().int()),
    paymentMethodName: z.string().nullable(),
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
    currency: o.currency,
    subtotal: o.subtotal,
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

export function orderAdminEndpoints(repo: OrderRepository): Endpoint[] {
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

  return [list, get, ship];
}
