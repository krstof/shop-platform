// Warenkorb und Zahlung in der Storefront (M6). Die geheimen Tokens liegen nur in Cookies
// (HttpOnly, Secure, SameSite=Lax, nur für den Pfad des Shops) und gehen vom Server der Storefront
// an die API; JavaScript im Browser sieht sie nie.
import type { AstroCookies } from "astro";
import { storeApi, StoreApiError } from "./store-api.js";

export interface CartLine {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
  readonly maxQuantity: number;
  readonly taxRatePercent: number;
}

export interface Cart {
  readonly count: number;
  readonly lines: readonly CartLine[];
  readonly subtotal: number;
  /** Rabatt durch Gutschein (seit Etappe „Gutscheine“; ältere API-Stände ohne). */
  readonly discount?: number;
  readonly couponCode?: string | null;
  readonly couponProblem?: string | null;
  readonly shipping: number;
  readonly total: number;
  readonly taxByRate: Readonly<Record<string, number>>;
}

export interface StoreOrder {
  readonly orderNumber: string;
  /** Seit der Bestellstatus-Seite (ISO 8601); ältere API-Stände ohne. */
  readonly placedAt?: string;
  readonly status: string;
  readonly paymentStatus: string;
  readonly email: string;
  readonly address: {
    readonly firstName: string;
    readonly lastName: string;
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
  };
  readonly lines: readonly { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  readonly subtotal: number;
  readonly discount?: number;
  readonly shipping: number;
  readonly total: number;
  readonly taxByRate: Readonly<Record<string, number>>;
}

export interface TestPayment {
  readonly status: "pending" | "captured" | "failed";
  readonly amount: number;
  readonly declinedAttempts: number;
  readonly order: StoreOrder;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function cookieOptions(shop: string) {
  return { path: `/${shop}`, httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 30 * 24 * 3600 };
}

const cartCookie = (shop: string) => `warenkorb-${shop}`;
const paymentCookie = (shop: string) => `zahlung-${shop}`;

function read(cookies: AstroCookies, name: string): string | undefined {
  const v = cookies.get(name)?.value;
  return v !== undefined && TOKEN.test(v) ? v : undefined;
}

/** Warenkorb aus dem Cookie; `undefined`, wenn es keinen (mehr) gibt. */
export async function loadCart(cookies: AstroCookies, shop: string): Promise<Cart | undefined> {
  const token = read(cookies, cartCookie(shop));
  if (token === undefined) return undefined;
  try {
    return await storeApi<Cart>(shop, `/carts/${token}`);
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) {
      cookies.delete(cartCookie(shop), { path: `/${shop}` });
      return undefined;
    }
    throw e;
  }
}

export async function warenkorbAnzahl(cookies: AstroCookies, shop: string): Promise<number> {
  return (await loadCart(cookies, shop))?.count ?? 0;
}

/** Token des Warenkorbs; legt bei Bedarf einen neuen an. */
async function cartToken(cookies: AstroCookies, shop: string): Promise<string> {
  const existing = read(cookies, cartCookie(shop));
  if (existing !== undefined && (await loadCart(cookies, shop)) !== undefined) return existing;
  const created = await storeApi<{ token: string }>(shop, "/carts", { method: "POST" });
  cookies.set(cartCookie(shop), created.token, cookieOptions(shop));
  return created.token;
}

/** Menge setzen (0 entfernt). Fehler wie „nur noch 2 Stück“ kommen als StoreApiError (409). */
export async function setQuantity(cookies: AstroCookies, shop: string, productId: string, quantity: number) {
  const token = await cartToken(cookies, shop);
  return storeApi<Cart>(shop, `/carts/${token}/lines/${productId}`, { method: "PUT", body: { quantity } });
}

export async function checkout(
  cookies: AstroCookies,
  shop: string,
  body: unknown,
  idempotencyKey: string,
): Promise<{ orderNumber: string }> {
  const token = read(cookies, cartCookie(shop));
  if (token === undefined) throw new StoreApiError(404, "not_found", "Der Warenkorb ist leer.");
  const r = await storeApi<{ orderNumber: string; paymentToken: string }>(shop, `/carts/${token}/checkout`, {
    method: "POST",
    body,
    headers: { "idempotency-key": idempotencyKey },
  });
  cookies.delete(cartCookie(shop), { path: `/${shop}` });
  cookies.set(paymentCookie(shop), r.paymentToken, cookieOptions(shop));
  return r;
}

export function paymentToken(cookies: AstroCookies, shop: string): string | undefined {
  return read(cookies, paymentCookie(shop));
}

export async function loadPayment(cookies: AstroCookies, shop: string): Promise<TestPayment | undefined> {
  const token = paymentToken(cookies, shop);
  if (token === undefined) return undefined;
  try {
    return await storeApi<TestPayment>(shop, `/test-payments/${token}`);
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) return undefined;
    throw e;
  }
}

export async function completePayment(cookies: AstroCookies, shop: string, outcome: "paid" | "declined") {
  const token = paymentToken(cookies, shop);
  if (token === undefined) return undefined;
  return storeApi<TestPayment>(shop, `/test-payments/${token}`, { method: "POST", body: { outcome } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function safeId(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

/** Ganze Zahl aus einem Formularfeld zwischen min und max, sonst `undefined`. */
export function safeInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : undefined;
}

/** Token aus der Adresse prüfen, bevor es in einen API-Pfad kommt. */
export function safeToken(value: string | undefined): string | undefined {
  return value !== undefined && TOKEN.test(value) ? value : undefined;
}

/** Zahlung samt Bestellung zu einem Token aus dem Link der E-Mail; `undefined`, wenn es sie nicht gibt. */
export async function loadPaymentByToken(shop: string, token: string): Promise<TestPayment | undefined> {
  try {
    return await storeApi<TestPayment>(shop, `/test-payments/${token}`);
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) return undefined;
    throw e;
  }
}

/** Gutschein einlösen. Gilt er nicht, kommt ein StoreApiError (422) mit dem Grund. */
export async function setCoupon(cookies: AstroCookies, shop: string, code: string): Promise<void> {
  const token = read(cookies, cartCookie(shop));
  if (token === undefined) throw new StoreApiError(404, "not_found", "Der Warenkorb ist leer.");
  await storeApi<Cart>(shop, `/carts/${token}/coupon`, { method: "PUT", body: { code } });
}

export async function removeCoupon(cookies: AstroCookies, shop: string): Promise<void> {
  const token = read(cookies, cartCookie(shop));
  if (token === undefined) return;
  await storeApi<Cart>(shop, `/carts/${token}/coupon`, { method: "DELETE" });
}
