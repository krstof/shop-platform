// Zugriff auf die Storefront-API (M4) vom Server der Storefront aus, nie aus dem Browser.
// Adresse: SHOP_STORE_API_URL, im Container http://api:3000 (internes Netz).
import { DEFAULT_DESIGN, type StoreDesign } from "./design.js";
import { VERSAND_KOSTENLOS, type Versand } from "./format.js";

export interface StoreShop {
  readonly handle: string;
  readonly name: string;
  /** Veröffentlichtes Aussehen (Shop-Editor Teil 1). Fehlt es, gilt der Standard. */
  readonly design?: StoreDesign;
  /** Versandkosten des Shops. Fehlen sie, gilt kostenlos. */
  readonly versand?: Versand;
  /** Geschlossen (Einstellungen „Allgemein“): Besucher sehen nur einen Hinweis. */
  readonly open?: boolean;
}

export interface StoreCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  /** Bild der Kategorie (seit Etappe „Kategoriebilder“; ältere API-Stände ohne). */
  readonly image?: StoreImage | null;
}

export interface StoreImage {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface StoreProduct {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly price: { readonly amount: number; readonly currency: "EUR" } | null;
  /** Bei einem Angebot der normale Preis zum Durchstreichen (seit Etappe „Angebotspreis“). */
  readonly compareAtPrice?: { readonly amount: number; readonly currency: "EUR" } | null;
  readonly taxRatePercent: number;
  readonly inStock: boolean;
  readonly maxQuantity: number;
  readonly categoryId: string | null;
  readonly images: readonly StoreImage[];
  /** Lieferzeit in Werktagen; `null`/fehlt: sofort lieferbar. */
  readonly deliveryDays?: { readonly min: number; readonly max: number } | null;
  /** Seit wann im Shop (für „Neu“); ältere API-Stände ohne. */
  readonly publishedAt?: string | null;
}

/** Fehler der API mit Statuscode; 404 heißt „gibt es nicht“ (Seite 404), alles andere 500. */
export class StoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: readonly { path: string; code: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "StoreApiError";
  }
}

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Prüft Kürzel und Adressen aus der URL, bevor sie in einen API-Pfad kommen. */
export function safeHandle(value: string | undefined): string | undefined {
  return value !== undefined && HANDLE.test(value) ? value : undefined;
}

export function safeSlug(value: string | undefined): string | undefined {
  return value !== undefined && value.length <= 200 && SLUG.test(value) ? value : undefined;
}

function baseUrl(): string {
  return (process.env["SHOP_STORE_API_URL"] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
}

export async function storeApi<T>(
  shop: string,
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl()}/store/v1/shops/${shop}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      "accept-language": "de",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return (await response.json()) as T;
  let problem: { code?: string; detail?: string; title?: string; errors?: StoreApiError["fields"] } = {};
  try {
    problem = (await response.json()) as typeof problem;
  } catch {
    // keine Problem-Details
  }
  throw new StoreApiError(
    response.status,
    problem.code ?? "unknown",
    problem.detail ?? problem.title ?? `Storefront-API antwortet ${response.status}`,
    problem.errors ?? [],
  );
}

/** Daten für Kopf und Navigation jeder Shop-Seite. `undefined`: Shop gibt es nicht (404). */
export async function loadShop(
  handle: string | undefined,
): Promise<{ shop: StoreShop; categories: StoreCategory[] } | undefined> {
  const h = safeHandle(handle);
  if (h === undefined) return undefined;
  try {
    const [shop, categories, design, versand, offen] = await Promise.all([
      storeApi<StoreShop>(h, ""),
      storeApi<{ data: StoreCategory[] }>(h, "/categories"),
      loadDesign(h),
      loadVersand(h),
      loadOffen(h),
    ]);
    return { shop: { ...shop, design, versand, open: offen }, categories: categories.data };
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) return undefined;
    throw e;
  }
}

/** Ist der Shop geöffnet (Einstellungen „Allgemein“)? Klappt die Abfrage nicht: ja. */
export async function loadOffen(handle: string): Promise<boolean> {
  try {
    return (await storeApi<{ open: boolean }>(handle, "/status")).open !== false;
  } catch {
    return true;
  }
}

/** Veröffentlichtes Aussehen. Klappt das nicht, sieht der Shop aus wie vorher (Standard). */
export async function loadDesign(handle: string): Promise<StoreDesign> {
  try {
    return await storeApi<StoreDesign>(handle, "/design");
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) throw e;
    return DEFAULT_DESIGN;
  }
}

/** Versandkosten. Klappt das nicht, zeigt der Shop „versandkostenfrei“ (Warenkorb rechnet trotzdem richtig). */
export async function loadVersand(handle: string): Promise<Versand> {
  try {
    const v = await storeApi<Versand>(handle, "/shipping");
    return { amount: v.amount, freeFrom: v.freeFrom };
  } catch {
    return VERSAND_KOSTENLOS;
  }
}
