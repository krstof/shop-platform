// Zugriff auf die Storefront-API (M4) vom Server der Storefront aus, nie aus dem Browser.
// Adresse: SHOP_STORE_API_URL, im Container http://api:3000 (internes Netz).

export interface StoreShop {
  readonly handle: string;
  readonly name: string;
}

export interface StoreCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
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
  readonly taxRatePercent: number;
  readonly inStock: boolean;
  readonly maxQuantity: number;
  readonly categoryId: string | null;
  readonly images: readonly StoreImage[];
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
    const [shop, categories] = await Promise.all([
      storeApi<StoreShop>(h, ""),
      storeApi<{ data: StoreCategory[] }>(h, "/categories"),
    ]);
    return { shop, categories: categories.data };
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) return undefined;
    throw e;
  }
}
