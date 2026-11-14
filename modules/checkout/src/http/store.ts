// Kaufen in der Storefront-API (M6): Warenkorb, Kasse als Gast und Testzahlung.
// Öffentlich, weil Gäste ohne Konto kaufen; geschützt sind Warenkorb und Zahlung durch zufällige
// Tokens (32 Byte), von denen die Datenbank nur den SHA-256 kennt. Die Storefront hält sie im
// Cookie (HttpOnly) und ruft die API nur von ihrem Server aus auf.
import type { Carts } from "@shop/cart";
import type { CatalogReader, SellableProduct } from "@shop/catalog";
import { defineEndpoint, idParam, singleLineText, type Endpoint } from "@shop/http";
import { OutOfStockError, type Inventory } from "@shop/inventory";
import { ConflictError, NotFoundError, withTenantTransaction, type Database } from "@shop/kernel";
import { shippingRateBp, taxIncluded, type Orders, type OrderView } from "@shop/orders";
import type { Payments } from "@shop/payments";
import type { ShopSettings } from "@shop/shop-settings";
import { z } from "zod";
import { confirmationMail, type MailSender } from "../mail.js";

export interface CheckoutDependencies {
  readonly database: Database<unknown>;
  readonly carts: Carts;
  readonly catalog: CatalogReader;
  readonly inventory: Pick<Inventory, "take">;
  readonly orders: Orders;
  readonly payments: Payments;
  readonly settings: ShopSettings;
  /** Versandkosten (Modul shipping). Ohne Angabe: Versand kostenlos. */
  readonly shipping?: { quote(subtotal: number): Promise<{ name: string; amount: number }> } | undefined;
  /** Bestätigung per E-Mail (lokal und auf dem Testserver: Mailpit). Ohne Angabe: keine E-Mail. */
  readonly mailer?: MailSender | undefined;
  /** Name des Shops für die E-Mail. */
  readonly shopName?: (() => Promise<string | undefined>) | undefined;
  readonly onMailError?: ((error: unknown) => void) | undefined;
}

const PUBLIC = {
  public: true,
  reason: "Gäste kaufen ohne Konto; Warenkorb und Zahlung schützt ein geheimes Token im Pfad.",
} as const;

const handle = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  .meta({ description: "Kürzel des Shops." });
const token = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({ description: "Geheimes Token (43 Zeichen), nur der Besitzer kennt es." });

const money = z.number().int();

const cartLineSchema = z.object({
  productId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  unitPrice: money,
  quantity: z.number().int(),
  lineTotal: money,
  maxQuantity: z.number().int(),
  taxRatePercent: z.number().int(),
});

const totalsShape = {
  subtotal: money.meta({ description: "Summe brutto in Cent." }),
  shipping: money.meta({ description: "Versandkosten brutto in Cent (0 = kostenlos)." }),
  total: money,
  taxByRate: z.record(z.string(), money).meta({ description: "Enthaltene MwSt. je Satz in Cent." }),
};

const cartSchema = z
  .object({
    count: z.number().int(),
    lines: z.array(cartLineSchema),
    ...totalsShape,
    shippingName: z.string().meta({ description: "Name der Versandart, etwa „Standardversand“." }),
  })
  .meta({
    id: "StoreCart",
    description: "Warenkorb mit aktuellen Preisen und Versandkosten des Shops.",
  });

const addressInput = z.strictObject({
  firstName: singleLineText(100),
  lastName: singleLineText(100),
  street: singleLineText(200).meta({ description: "Straße und Hausnummer." }),
  postalCode: z.string().regex(/^\d{5}$/, "Bitte eine fünfstellige Postleitzahl angeben."),
  city: singleLineText(100),
});

const checkoutInput = z.strictObject({
  email: z.email().max(254),
  address: addressInput,
});

const orderSchema = z
  .object({
    orderNumber: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
    email: z.string(),
    address: z.object({
      firstName: z.string(),
      lastName: z.string(),
      street: z.string(),
      postalCode: z.string(),
      city: z.string(),
    }),
    lines: z.array(
      z.object({ name: z.string(), quantity: z.number().int(), unitPrice: money, lineTotal: money }),
    ),
    ...totalsShape,
  })
  .meta({ id: "StoreOrder" });

const testPaymentSchema = z
  .object({
    status: z.enum(["pending", "captured", "failed"]),
    amount: money,
    declinedAttempts: z.number().int(),
    order: orderSchema,
  })
  .meta({ id: "StoreTestPayment", description: "Testzahlung mit der zugehörigen Bestellung." });

function toStoreOrder(o: OrderView): z.input<typeof orderSchema> {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    email: o.email,
    address: {
      firstName: o.address.firstName,
      lastName: o.address.lastName,
      street: o.address.street,
      postalCode: o.address.postalCode,
      city: o.address.city,
    },
    lines: o.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    subtotal: o.subtotal,
    shipping: o.shipping,
    total: o.total,
    taxByRate: o.taxByRate,
  };
}

const NO_CART = "Diesen Warenkorb gibt es nicht (mehr).";

export function checkoutEndpoints(deps: CheckoutDependencies): Endpoint[] {
  const { carts, catalog } = deps;

  /** Warenkorb mit aktuellen Daten; Positionen, die es nicht mehr gibt, fallen weg. */
  async function cartView(lines: readonly { variantId: string; quantity: number }[]) {
    const products = await catalog.sellable({ variantIds: lines.map((l) => l.variantId) });
    const byVariant = new Map(products.map((p) => [p.variantId, p]));
    const out = lines.flatMap((l) => {
      const p = byVariant.get(l.variantId);
      if (p === undefined || p.price === null) return [];
      const quantity = l.quantity;
      return [{ product: p, quantity, total: p.price.amount * quantity }];
    });
    const subtotal = out.reduce((a, l) => a + l.total, 0);
    const shipping = (await deps.shipping?.quote(subtotal)) ?? {
      name: "Standardversand (kostenlos)",
      amount: 0,
    };
    const byRate = new Map<number, { gross: number }>();
    for (const l of out) {
      const bp = l.product.taxRatePercent * 100;
      byRate.set(bp, { gross: (byRate.get(bp)?.gross ?? 0) + l.total });
    }
    // Wie beim Bestellen (Modul orders): Steuer je Position, Versand zum Satz mit dem größten Warenwert.
    const taxByRate: Record<string, number> = {};
    const addTax = (bp: number, gross: number) => {
      const key = String(bp / 100);
      taxByRate[key] = (taxByRate[key] ?? 0) + taxIncluded(gross, bp);
    };
    for (const l of out) addTax(l.product.taxRatePercent * 100, l.total);
    if (shipping.amount > 0) addTax(shippingRateBp(byRate), shipping.amount);
    return {
      shipping,
      items: out,
      view: {
        count: out.reduce((a, l) => a + l.quantity, 0),
        lines: out.map((l) => ({
          productId: l.product.id,
          slug: l.product.slug,
          name: l.product.name,
          imageUrl: l.product.images[0]?.thumbnailUrl ?? null,
          unitPrice: l.product.price?.amount ?? 0,
          quantity: l.quantity,
          lineTotal: l.total,
          maxQuantity: l.product.maxQuantity,
          taxRatePercent: l.product.taxRatePercent,
        })),
        subtotal,
        shipping: shipping.amount,
        shippingName: shipping.name,
        total: subtotal + shipping.amount,
        taxByRate,
      },
    };
  }

  async function requireCart(t: string) {
    const cart = await carts.find(t);
    if (cart === undefined) throw new NotFoundError({ detail: NO_CART });
    return cart;
  }

  const createCart = defineEndpoint({
    api: "store",
    method: "POST",
    path: "/shops/{shopHandle}/carts",
    operationId: "createStoreCart",
    summary: "Warenkorb anlegen",
    description: "Legt einen leeren Warenkorb an. Das Token gibt es nur in dieser Antwort.",
    tags: ["Kaufen"],
    access: PUBLIC,
    idempotency: "none",
    params: z.strictObject({ shopHandle: handle }),
    response: {
      status: 201,
      description: "Der neue Warenkorb.",
      schema: z.object({ token: z.string(), cart: cartSchema }),
    },
    handler: async () => {
      const { token: t } = await carts.create(await deps.settings.storefrontChannelId());
      return { token: t, cart: (await cartView([])).view };
    },
  });

  const getCart = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/carts/{cartToken}",
    operationId: "getStoreCart",
    summary: "Warenkorb lesen",
    description: "Warenkorb mit aktuellen Preisen und Summen.",
    tags: ["Kaufen"],
    access: PUBLIC,
    params: z.strictObject({ shopHandle: handle, cartToken: token }),
    response: { status: 200, description: "Der Warenkorb.", schema: cartSchema },
    problems: [404],
    handler: async ({ params }) => (await cartView((await requireCart(params.cartToken)).lines)).view,
  });

  const setLine = defineEndpoint({
    api: "store",
    method: "PUT",
    path: "/shops/{shopHandle}/carts/{cartToken}/lines/{productId}",
    operationId: "setStoreCartLine",
    summary: "Menge im Warenkorb setzen",
    description:
      "Setzt die Menge eines Produkts im Warenkorb; 0 nimmt es heraus. Mehr als vorrätig (höchstens " +
      "99) geht nicht (409).",
    tags: ["Kaufen"],
    access: PUBLIC,
    params: z.strictObject({ shopHandle: handle, cartToken: token, productId: idParam }),
    body: z.strictObject({ quantity: z.number().int().min(0).max(99) }),
    bodyExample: { quantity: 2 },
    response: { status: 200, description: "Der Warenkorb danach.", schema: cartSchema },
    problems: [404, 409],
    handler: async ({ params, body }) => {
      const cart = await requireCart(params.cartToken);
      const [product]: SellableProduct[] = await catalog.sellable({ productIds: [params.productId] });
      if (product === undefined) throw new NotFoundError({ detail: "Dieses Produkt gibt es nicht (mehr)." });
      if (body.quantity > product.maxQuantity)
        throw new ConflictError({
          detail:
            product.maxQuantity === 0
              ? `„${product.name}“ ist leider ausverkauft.`
              : `Von „${product.name}“ sind nur noch ${product.maxQuantity} Stück da.`,
        });
      await carts.setQuantity(cart.id, product.variantId, body.quantity);
      return (await cartView((await requireCart(params.cartToken)).lines)).view;
    },
  });

  const checkout = defineEndpoint({
    api: "store",
    method: "POST",
    path: "/shops/{shopHandle}/carts/{cartToken}/checkout",
    operationId: "checkoutStoreCart",
    summary: "Bestellen (als Gast)",
    description:
      "Legt aus dem Warenkorb eine Bestellung an (wartet auf Zahlung), nimmt die Ware aus dem Lager " +
      "und eröffnet eine Testzahlung. Idempotency-Key ist Pflicht, damit ein doppelter Klick nicht " +
      "doppelt bestellt. Danach ist der Warenkorb verbraucht.",
    tags: ["Kaufen"],
    access: PUBLIC,
    idempotency: "required",
    params: z.strictObject({ shopHandle: handle, cartToken: token }),
    body: checkoutInput,
    bodyExample: {
      email: "kim@example.org",
      address: {
        firstName: "Kim",
        lastName: "Muster",
        street: "Teeweg 1",
        postalCode: "20095",
        city: "Hamburg",
      },
    },
    response: {
      status: 201,
      description: "Bestellung angelegt; jetzt bezahlen.",
      schema: z.object({ orderNumber: z.string(), paymentToken: z.string(), total: money }),
    },
    problems: [404, 409],
    handler: async ({ params, body }) => {
      const cart = await requireCart(params.cartToken);
      const { items, shipping } = await cartView(cart.lines);
      if (items.length === 0) throw new ConflictError({ detail: "Der Warenkorb ist leer." });
      try {
        return await withTenantTransaction(deps.database, async () => {
          const order = await deps.orders.place({
            email: body.email,
            address: { ...body.address, countryCode: "DE" },
            paymentMethodName: "Testzahlung",
            paymentProvider: "test",
            shipping,
            lines: items.map((l) => ({
              productId: l.product.id,
              variantId: l.product.variantId,
              sku: l.product.sku,
              name: l.product.name,
              quantity: l.quantity,
              unitPrice: l.product.price?.amount ?? 0,
              taxClassCode: l.product.taxClass,
              imageMediaId: l.product.imageMediaId,
            })),
          });
          await deps.inventory.take(
            items.map((l) => ({ variantId: l.product.variantId, quantity: l.quantity })),
            order.id,
          );
          const payment = await deps.payments.createTestPayment({
            orderId: order.id,
            amount: order.total,
            currency: order.currency,
          });
          await carts.markConverted(cart.id);
          return { orderNumber: order.orderNumber, paymentToken: payment.token, total: order.total };
        });
      } catch (error) {
        if (!(error instanceof OutOfStockError)) throw error;
        const p = items.find((l) => l.product.variantId === error.variantId)?.product;
        throw new ConflictError({
          detail: `Von „${p?.name ?? "einem Artikel"}“ ist nicht mehr genug da. Bitte die Menge im Warenkorb anpassen.`,
        });
      }
    },
  });

  async function paymentView(t: string) {
    const payment = await deps.payments.findTestPayment(t);
    if (payment === undefined) throw new NotFoundError({ detail: "Diese Zahlung gibt es nicht." });
    const order = await deps.orders.view(payment.orderId);
    if (order === undefined) throw new NotFoundError();
    return { payment, order };
  }

  const getPayment = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/test-payments/{paymentToken}",
    operationId: "getStoreTestPayment",
    summary: "Testzahlung lesen",
    description: "Stand der Testzahlung und die zugehörige Bestellung (für Zahlungs- und Dankeseite).",
    tags: ["Kaufen"],
    access: PUBLIC,
    params: z.strictObject({ shopHandle: handle, paymentToken: token }),
    response: { status: 200, description: "Zahlung und Bestellung.", schema: testPaymentSchema },
    problems: [404],
    handler: async ({ params }) => {
      const { payment, order } = await paymentView(params.paymentToken);
      return {
        status: payment.status,
        amount: payment.amount,
        declinedAttempts: payment.declinedAttempts,
        order: toStoreOrder(order),
      };
    },
  });

  const completePayment = defineEndpoint({
    api: "store",
    method: "POST",
    path: "/shops/{shopHandle}/test-payments/{paymentToken}",
    operationId: "completeStoreTestPayment",
    summary: "Testzahlung abschließen",
    description:
      "Simuliert den Zahlungsanbieter: `paid` bucht die Zahlung und bestätigt die Bestellung (mit " +
      "E-Mail), `declined` lehnt ab; danach kann man es erneut versuchen. Eine bezahlte Zahlung " +
      "bleibt bezahlt.",
    tags: ["Kaufen"],
    access: PUBLIC,
    idempotency: "none",
    params: z.strictObject({ shopHandle: handle, paymentToken: token }),
    body: z.strictObject({ outcome: z.enum(["paid", "declined"]) }),
    bodyExample: { outcome: "paid" },
    response: { status: 200, description: "Zahlung und Bestellung danach.", schema: testPaymentSchema },
    problems: [404],
    handler: async ({ params, body }) => {
      await paymentView(params.paymentToken); // 404, wenn es die Zahlung nicht gibt
      let confirmed = false;
      await withTenantTransaction(deps.database, async () => {
        const p = await deps.payments.completeTestPayment(params.paymentToken, body.outcome);
        if (p?.status === "captured") confirmed = await deps.orders.markPaid(p.orderId);
      });
      const { payment, order } = await paymentView(params.paymentToken);
      if (confirmed && deps.mailer !== undefined) {
        // Nach dem Commit, und Fehler beim Versand ändern nichts an der Bestellung.
        const shopName = (await deps.shopName?.()) ?? "Testshop";
        await deps.mailer
          .send(confirmationMail(order, shopName))
          .catch((e: unknown) => deps.onMailError?.(e));
      }
      return {
        status: payment.status,
        amount: payment.amount,
        declinedAttempts: payment.declinedAttempts,
        order: toStoreOrder(order),
      };
    },
  });

  return [createCart, getCart, setLine, checkout, getPayment, completePayment];
}
