// Bestellung per Hand anlegen (15.11.2026, Kristof: Plus-Knopf in „Bestellungen“). Etwa für
// telefonische Bestellungen: gleiche Momentaufnahme, gleiche Steuern, Versandkosten und Bestand wie
// beim Kauf im Shop, nur ohne Warenkorb und Testzahlung. „Bezahlt“ setzt die Bestellung gleich auf
// bezahlt (zu versenden), sonst wartet sie auf Zahlung.
import {
  defineEndpoint,
  idParam,
  multiLineText,
  singleLineText,
  type Endpoint,
  emailInput,
} from "@shop/http";
import { OutOfStockError } from "@shop/inventory";
import { ConflictError, ValidationError, withTenantTransaction } from "@shop/kernel";
import { z } from "zod";
import type { CheckoutDependencies } from "./store.js";

export const MAX_MANUAL_LINES = 50;

const manualOrderInput = z.strictObject({
  email: emailInput(),
  address: z.strictObject({
    firstName: singleLineText(100),
    lastName: singleLineText(100),
    street: singleLineText(200).meta({ description: "Straße und Hausnummer." }),
    postalCode: z.string().regex(/^\d{5}$/, "Bitte eine fünfstellige Postleitzahl angeben."),
    city: singleLineText(100),
  }),
  lines: z
    .array(z.strictObject({ productId: idParam, quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(MAX_MANUAL_LINES),
  paid: z.boolean().meta({ description: "Schon bezahlt (etwa bar oder per Überweisung)?" }),
  shipping: z.boolean().optional().meta({ description: "Versandkosten berechnen (Standard: ja)." }),
  note: multiLineText(500).optional().meta({ description: "Anmerkung, steht bei der Bestellung." }),
});

export function manualOrderEndpoints(deps: CheckoutDependencies): Endpoint[] {
  return [
    defineEndpoint({
      api: "admin",
      method: "POST",
      path: "/orders",
      operationId: "createManualOrder",
      summary: "Bestellung per Hand anlegen",
      description:
        "Legt eine Bestellung für veröffentlichte Produkte an, etwa für eine telefonische Bestellung: " +
        "Preise und Steuern wie im Shop, Versandkosten nach den Regeln des Shops (abschaltbar), die Ware " +
        "geht aus dem Lager. Mit `paid: true` ist sie sofort bezahlt und zu versenden.",
      tags: ["Bestellungen"],
      access: { scopes: ["orders:write"] },
      body: manualOrderInput,
      bodyExample: {
        email: "kim@example.org",
        address: {
          firstName: "Kim",
          lastName: "Muster",
          street: "Teeweg 1",
          postalCode: "20095",
          city: "Hamburg",
        },
        lines: [{ productId: "0190a0b0-0000-7000-8000-000000000001", quantity: 2 }],
        paid: true,
      },
      response: {
        status: 201,
        description: "Die angelegte Bestellung.",
        schema: z
          .object({ id: z.uuid(), orderNumber: z.string(), total: z.number().int() })
          .meta({ id: "CreatedManualOrder" }),
      },
      problems: [409],
      handler: async ({ body }) => {
        const quantities = new Map<string, number>();
        for (const l of body.lines)
          quantities.set(l.productId, (quantities.get(l.productId) ?? 0) + l.quantity);
        const products = await deps.catalog.sellable({ productIds: [...quantities.keys()] });
        const byId = new Map(products.map((p) => [p.id, p]));
        const missing = body.lines.findIndex((l) => !byId.has(l.productId));
        if (missing >= 0)
          throw new ValidationError({
            detail: "Dieses Produkt gibt es nicht oder es ist nicht im Shop.",
            errors: [
              {
                path: `/lines/${missing}/productId`,
                code: "unknown_product",
                message: "Dieses Produkt gibt es nicht oder es ist nicht im Shop.",
              },
            ],
          });
        const items = [...quantities].map(([id, quantity]) => {
          const p = byId.get(id);
          if (p === undefined || p.price === null) throw new ConflictError({ detail: "Produkt ohne Preis." });
          if (quantity > p.maxQuantity && quantity > 0)
            throw new ConflictError({
              detail:
                p.maxQuantity === 0
                  ? `„${p.name}“ ist ausverkauft.`
                  : `Von „${p.name}“ sind nur noch ${p.maxQuantity} Stück da.`,
            });
          return { product: p, quantity };
        });
        const subtotal = items.reduce((s, i) => s + (i.product.price?.amount ?? 0) * i.quantity, 0);
        const shipping =
          body.shipping === false || deps.shipping === undefined
            ? undefined
            : await deps.shipping.quote(subtotal);
        try {
          const order = await withTenantTransaction(deps.database, async () => {
            const placed = await deps.orders.place({
              email: body.email,
              address: { ...body.address, countryCode: "DE" },
              paymentMethodName: body.paid ? "Per Hand (bezahlt)" : "Per Hand",
              paymentProvider: "manual",
              shipping,
              customerNote: body.note,
              lines: items.map((i) => ({
                productId: i.product.id,
                variantId: i.product.variantId,
                sku: i.product.sku,
                name: i.product.name,
                quantity: i.quantity,
                unitPrice: i.product.price?.amount ?? 0,
                taxClassCode: i.product.taxClass,
                imageMediaId: i.product.imageMediaId,
              })),
            });
            await deps.inventory.take(
              items.map((i) => ({ variantId: i.product.variantId, quantity: i.quantity })),
              placed.id,
            );
            if (body.paid) await deps.orders.markPaid(placed.id);
            return placed;
          });
          return { id: order.id, orderNumber: order.orderNumber, total: order.total };
        } catch (error) {
          if (!(error instanceof OutOfStockError)) throw error;
          const p = items.find((i) => i.product.variantId === error.variantId)?.product;
          throw new ConflictError({ detail: `Von „${p?.name ?? "einem Artikel"}“ ist nicht mehr genug da.` });
        }
      },
    }),
  ];
}
