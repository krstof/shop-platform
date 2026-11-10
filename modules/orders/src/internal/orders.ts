// Bestellungen anlegen und lesen (M6, M7). Eine Bestellung ist eine Momentaufnahme: Namen, Preise
// und Steuersätze werden kopiert, danach ändern sich nur noch Status und Notizen (Trigger in der DB).
import { getContext, withTenantTransaction, type Database, type Transaction } from "@shop/kernel";
import type { ShopSettings } from "@shop/shop-settings";
import type { DB } from "../db.generated.js";

export interface OrderAddress {
  readonly firstName: string;
  readonly lastName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly countryCode: "DE";
}

export interface NewOrderLine {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string | null;
  readonly name: string;
  readonly quantity: number;
  /** Bruttopreis je Stück in Cent. */
  readonly unitPrice: number;
  readonly taxClassCode: "standard" | "reduced";
  readonly imageMediaId: string | null;
}

export interface NewOrder {
  readonly email: string;
  readonly address: OrderAddress;
  readonly lines: readonly NewOrderLine[];
  readonly paymentMethodName: string;
  readonly paymentProvider: string;
}

export type OrderStatus = "pending_payment" | "open" | "in_progress" | "completed" | "cancelled";
export type PaymentState = "unpaid" | "authorized" | "paid" | "partially_refunded" | "refunded" | "failed";
export type FulfillmentState =
  "unfulfilled" | "partially_shipped" | "shipped" | "delivered" | "partially_returned" | "returned";

export interface OrderLineView {
  readonly position: number;
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly taxRatePercent: number;
  readonly imageMediaId: string | null;
}

export interface OrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentState;
  readonly fulfillmentStatus: FulfillmentState;
  readonly email: string;
  readonly address: OrderAddress;
  readonly currency: string;
  readonly subtotal: number;
  readonly shipping: number;
  readonly tax: number;
  readonly total: number;
  /** Enthaltene Steuer je Satz, etwa { "7": 58 }. */
  readonly taxByRate: Readonly<Record<string, number>>;
  readonly paymentMethodName: string | null;
  readonly placedAt: Date;
  readonly lines: readonly OrderLineView[];
}

const RATE_BP = { standard: 1900, reduced: 700 } as const;

/** Enthaltene Steuer aus dem Bruttobetrag, kaufmännisch gerundet. */
export function taxIncluded(gross: number, rateBp: number): number {
  return Math.round((gross * rateBp) / (10_000 + rateBp));
}

function placed(trx: Transaction<DB>) {
  return trx.selectFrom("orders.order");
}

export function orderRepository(database: Database<unknown>, settings: ShopSettings) {
  const db = database as Database<DB>;
  const tenant = () => getContext()?.tenantId ?? "";

  async function view(trx: Transaction<DB>, id: string): Promise<OrderView | undefined> {
    const o = await placed(trx).selectAll().where("id", "=", id).executeTakeFirst();
    if (o === undefined) return undefined;
    const [lines, address, taxes] = await Promise.all([
      trx
        .selectFrom("orders.order_line")
        .selectAll()
        .where("order_id", "=", id)
        .orderBy("position")
        .execute(),
      trx
        .selectFrom("orders.order_address")
        .selectAll()
        .where("order_id", "=", id)
        .where("kind", "=", "shipping")
        .executeTakeFirst(),
      trx.selectFrom("orders.order_tax_line").selectAll().where("order_id", "=", id).execute(),
    ]);
    return {
      id: o.id,
      orderNumber: o.order_number,
      status: o.status as OrderStatus,
      paymentStatus: o.payment_status as PaymentState,
      fulfillmentStatus: o.fulfillment_status as FulfillmentState,
      email: o.email ?? "",
      address: {
        firstName: address?.first_name ?? "",
        lastName: address?.last_name ?? "",
        street: address?.address_line1 ?? "",
        postalCode: address?.postal_code ?? "",
        city: address?.city ?? "",
        countryCode: "DE",
      },
      currency: o.currency,
      subtotal: Number(o.subtotal_amount),
      shipping: Number(o.shipping_amount),
      tax: Number(o.tax_amount),
      total: Number(o.total_amount),
      taxByRate: Object.fromEntries(taxes.map((t) => [String(t.rate_bp / 100), Number(t.tax_amount)])),
      paymentMethodName: o.payment_method_name,
      placedAt: o.placed_at,
      lines: lines.map((l) => ({
        position: l.position,
        productId: l.product_id,
        name: l.product_name,
        sku: l.sku,
        quantity: l.quantity,
        unitPrice: Number(l.unit_price_amount),
        lineTotal: Number(l.line_total_amount),
        taxRatePercent: l.tax_rate_bp / 100,
        imageMediaId: l.image_media_id,
      })),
    };
  }

  return {
    view: (id: string) => withTenantTransaction(db, (trx) => view(trx, id)),

    /** Legt die Bestellung an (Status „wartet auf Zahlung“). Läuft in der Transaktion des Aufrufers mit. */
    async place(input: NewOrder): Promise<OrderView> {
      return withTenantTransaction(db, async (trx) => {
        if (input.lines.length === 0) throw new RangeError("Bestellung ohne Positionen");
        const channelId = await settings.storefrontChannelId();
        const orderNumber = await settings.nextOrderNumber();
        const lines = input.lines.map((l, i) => {
          const rateBp = RATE_BP[l.taxClassCode];
          const total = l.unitPrice * l.quantity;
          return { ...l, position: i + 1, rateBp, total, tax: taxIncluded(total, rateBp) };
        });
        const subtotal = lines.reduce((a, l) => a + l.total, 0);
        const byRate = new Map<number, { gross: number; tax: number }>();
        for (const l of lines) {
          const g = byRate.get(l.rateBp) ?? { gross: 0, tax: 0 };
          byRate.set(l.rateBp, { gross: g.gross + l.total, tax: g.tax + l.tax });
        }
        const tax = [...byRate.values()].reduce((a, g) => a + g.tax, 0);
        const order = await trx
          .insertInto("orders.order")
          .values({
            tenant_id: tenant(),
            order_number: orderNumber,
            channel_id: channelId,
            email: input.email,
            locale: "de",
            currency: "EUR",
            tax_display: "gross",
            subtotal_amount: subtotal,
            shipping_amount: 0,
            discount_amount: 0,
            tax_amount: tax,
            total_amount: subtotal,
            shipping_method_name: "Standardversand (kostenlos)",
            payment_method_name: input.paymentMethodName,
            payment_provider: input.paymentProvider,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("orders.order_line")
          .values(
            lines.map((l) => ({
              tenant_id: tenant(),
              order_id: order.id,
              position: l.position,
              product_id: l.productId,
              variant_id: l.variantId,
              sku: l.sku,
              product_name: l.name,
              quantity: l.quantity,
              unit_price_amount: l.unitPrice,
              unit_price_includes_tax: true,
              line_subtotal_amount: l.total,
              tax_class_code: l.taxClassCode,
              tax_rate_bp: l.rateBp,
              vat_category_code: "S",
              tax_amount: l.tax,
              line_total_amount: l.total,
              image_media_id: l.imageMediaId,
            })),
          )
          .execute();
        const a = input.address;
        await trx
          .insertInto("orders.order_address")
          .values(
            (["billing", "shipping"] as const).map((kind) => ({
              tenant_id: tenant(),
              order_id: order.id,
              kind,
              first_name: a.firstName,
              last_name: a.lastName,
              address_line1: a.street,
              postal_code: a.postalCode,
              city: a.city,
              country_code: a.countryCode,
            })),
          )
          .execute();
        await trx
          .insertInto("orders.order_tax_line")
          .values(
            [...byRate.entries()].map(([rateBp, g]) => ({
              tenant_id: tenant(),
              order_id: order.id,
              tax_class_code: rateBp === 700 ? "reduced" : "standard",
              rate_bp: rateBp,
              vat_category_code: "S",
              country_code: "DE",
              taxable_amount: g.gross - g.tax,
              tax_amount: g.tax,
            })),
          )
          .execute();
        const result = await view(trx, order.id);
        if (result === undefined) throw new Error("Bestellung nach dem Anlegen nicht lesbar");
        return result;
      });
    },

    /** Zahlung eingegangen: Bestellung ist offen und bezahlt. Nur aus „wartet auf Zahlung“. */
    async markPaid(id: string): Promise<boolean> {
      const r = await withTenantTransaction(db, (trx) =>
        trx
          .updateTable("orders.order")
          .set({ status: "open", payment_status: "paid", updated_at: new Date() })
          .where("id", "=", id)
          .where("status", "=", "pending_payment")
          .executeTakeFirst(),
      );
      return r.numUpdatedRows > 0n;
    },
  };
}

export type OrderRepository = ReturnType<typeof orderRepository>;
