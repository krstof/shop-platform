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

export interface OrderSummary {
  readonly id: string;
  readonly orderNumber: string;
  readonly placedAt: Date;
  readonly customerName: string;
  readonly email: string;
  readonly total: number;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentState;
  readonly fulfillmentStatus: FulfillmentState;
  readonly itemCount: number;
}

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

/** Suchmuster für ILIKE: `%`, `_` und `\\` zählen als normale Zeichen. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Enthaltene Steuer aus dem Bruttobetrag, kaufmännisch gerundet. */
export function taxIncluded(gross: number, rateBp: number): number {
  return Math.round((gross * rateBp) / (10_000 + rateBp));
}

function placed(trx: Transaction<DB>) {
  return trx.selectFrom("orders.order");
}

export interface OrderSummaryStats {
  /** Älteste zuerst, je Kalendertag in deutscher Zeit, auch Tage ohne Bestellung. */
  readonly days: readonly { readonly date: string; readonly orders: number; readonly revenue: number }[];
  readonly toShip: number;
  readonly awaitingPayment: number;
}

const BERLIN = "Europe/Berlin";
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BERLIN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Kalendertag in deutscher Zeit, etwa „2026-11-14“. */
export function berlinDate(at: Date): string {
  return DAY_FORMAT.format(at);
}

/** Die letzten `days` Kalendertage in deutscher Zeit bis einschließlich heute, älteste zuerst. */
export function berlinDates(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    // Mittag UTC liegt sicher im richtigen deutschen Tag, auch bei Sommer- und Winterzeit.
    const [y, m, d] = berlinDate(now).split("-").map(Number) as [number, number, number];
    out.push(berlinDate(new Date(Date.UTC(y, m - 1, d - i, 12))));
  }
  return out;
}

/** Mitternacht eines deutschen Kalendertags als Zeitpunkt. */
export function berlinMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // Deutschland liegt 1 oder 2 Stunden vor UTC: den Kandidaten nehmen, der dort 00:00 zeigt.
  for (const offset of [1, 2]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, -offset));
    const time = new Intl.DateTimeFormat("de-DE", {
      timeZone: BERLIN,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(candidate);
    if (berlinDate(candidate) === date && time === "00:00") return candidate;
  }
  return new Date(Date.UTC(y, m - 1, d));
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

    /** Neueste zuerst (UUIDv7 absteigend), eine Zeile mehr als verlangt (nächste Seite?). */
    /**
     * Filter: `status` (Stand der Bestellung) und `search` (Teil der Bestellnummer, der E-Mail oder des
     * Namens, ohne Groß-/Kleinschreibung; „Kim Muster“ findet Vor- plus Nachname).
     */
    async list(f: {
      limit: number;
      beforeId?: string | undefined;
      status?: OrderStatus | undefined;
      search?: string | undefined;
    }): Promise<OrderSummary[]> {
      return withTenantTransaction(db, async (trx) => {
        let q = placed(trx)
          .leftJoin("orders.order_address as a", (j) =>
            j.onRef("a.order_id", "=", "orders.order.id").on("a.kind", "=", "shipping"),
          )
          .select([
            "orders.order.id",
            "orders.order.order_number",
            "orders.order.placed_at",
            "orders.order.email",
            "orders.order.total_amount",
            "orders.order.status",
            "orders.order.payment_status",
            "orders.order.fulfillment_status",
            "a.first_name",
            "a.last_name",
          ])
          .select((eb) =>
            eb
              .selectFrom("orders.order_line as l")
              .select((e) => e.fn.coalesce(e.fn.sum<string>("l.quantity"), e.val("0")).as("n"))
              .whereRef("l.order_id", "=", "orders.order.id")
              .as("item_count"),
          )
          .orderBy("orders.order.id", "desc")
          .limit(f.limit + 1);
        if (f.beforeId !== undefined) q = q.where("orders.order.id", "<", f.beforeId);
        if (f.status !== undefined) q = q.where("orders.order.status", "=", f.status);
        if (f.search !== undefined) {
          const pattern = likePattern(f.search);
          q = q.where((eb) =>
            eb.or([
              eb("orders.order.order_number", "ilike", pattern),
              eb("orders.order.email", "ilike", pattern),
              eb(eb.fn<string>("concat_ws", [eb.val(" "), "a.first_name", "a.last_name"]), "ilike", pattern),
            ]),
          );
        }
        return (await q.execute()).map((r) => ({
          id: r.id,
          orderNumber: r.order_number,
          placedAt: r.placed_at,
          customerName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          email: r.email ?? "",
          total: Number(r.total_amount),
          status: r.status as OrderStatus,
          paymentStatus: r.payment_status as PaymentState,
          fulfillmentStatus: r.fulfillment_status as FulfillmentState,
          itemCount: Number(r.item_count ?? 0),
        }));
      });
    },

    /**
     * Als versendet markieren (M7): nur bezahlte, offene Bestellungen. Danach ist sie erledigt.
     * Ergebnis: neuer Stand, `not_found` oder `not_allowed` (noch nicht bezahlt, schon versendet).
     */
    async markShipped(
      id: string,
    ): Promise<{ kind: "ok"; order: OrderView } | { kind: "not_found" | "not_allowed" }> {
      return withTenantTransaction(db, async (trx) => {
        const o = await placed(trx)
          .select(["status", "payment_status", "fulfillment_status"])
          .where("id", "=", id)
          .forUpdate()
          .executeTakeFirst();
        if (o === undefined) return { kind: "not_found" as const };
        if (o.payment_status !== "paid" || o.fulfillment_status !== "unfulfilled" || o.status === "cancelled")
          return { kind: "not_allowed" as const };
        await trx
          .updateTable("orders.order")
          .set({
            fulfillment_status: "shipped",
            status: "completed",
            seen_at: new Date(),
            updated_at: new Date(),
          })
          .where("id", "=", id)
          .execute();
        const order = await view(trx, id);
        if (order === undefined) return { kind: "not_found" as const };
        return { kind: "ok" as const, order };
      });
    },

    /**
     * Kennzahlen für die Übersicht: bezahlte Bestellungen und Umsatz je Tag (deutsche Zeit) der letzten
     * `days` Tage, dazu wie viele zu versenden sind und wie viele auf die Zahlung warten.
     */
    async summary(now: Date, days: number): Promise<OrderSummaryStats> {
      return withTenantTransaction(db, async (trx) => {
        const dates = berlinDates(now, days);
        const from = berlinMidnight(dates[0] ?? "");
        const paid = await placed(trx)
          .select(["placed_at", "total_amount"])
          .where("payment_status", "=", "paid")
          .where("placed_at", ">=", from)
          .execute();
        const byDay = new Map(dates.map((d) => [d, { date: d, orders: 0, revenue: 0 }]));
        for (const o of paid) {
          const day = byDay.get(berlinDate(o.placed_at));
          if (day === undefined) continue;
          day.orders += 1;
          day.revenue += Number(o.total_amount);
        }
        const counts = await placed(trx)
          .select((eb) => [
            eb.fn.countAll<string>().filterWhere("status", "=", "open").as("to_ship"),
            eb.fn.countAll<string>().filterWhere("status", "=", "pending_payment").as("awaiting"),
          ])
          .executeTakeFirstOrThrow();
        return {
          days: [...byDay.values()],
          toShip: Number(counts.to_ship),
          awaitingPayment: Number(counts.awaiting),
        };
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
