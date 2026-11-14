// Kleiner Client für Auth- und Admin-API (M3). Das Backoffice läuft unter derselben Adresse wie die
// API (admin.<Domain>), das Sitzungs-Cookie geht deshalb von selbst mit; kein Token im Browser.
// Fehler kommen als Problem Details (RFC 9457) und werden zu ApiError mit deutschem Text.

export interface FieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Fehlertext zu einem Feld, etwa „/price/amount“. */
  field(path: string): string | undefined {
    return this.errors.find((e) => e.path === path || e.path.startsWith(`${path}/`))?.message;
  }
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  /** Shop, für den die Anfrage gilt (Kopfzeile Shop-Id, Pflicht in der Admin-API). */
  readonly shopId?: string;
  /** Version für If-Match bei Änderungen. */
  readonly version?: number;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", "accept-language": "de" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.shopId !== undefined) headers["shop-id"] = options.shopId;
  if (options.version !== undefined) headers["if-match"] = `"${options.version}"`;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(0, "network", "Keine Verbindung zum Server. Bitte gleich noch einmal versuchen.");
  }
  if (response.ok) return (await response.json()) as T;
  throw await toApiError(response);
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const p = (await response.json()) as {
      code?: string;
      title?: string;
      detail?: string;
      errors?: FieldError[];
    };
    const message = p.detail ?? p.title ?? fallbackText(response.status);
    return new ApiError(response.status, p.code ?? "unknown", message, p.errors ?? []);
  } catch {
    return new ApiError(response.status, "unknown", fallbackText(response.status));
  }
}

function fallbackText(status: number): string {
  if (status === 413) return "Die Datei ist zu groß.";
  if (status === 429) return "Zu viele Versuche. Bitte kurz warten.";
  if (status >= 500) return "Da ist etwas schiefgegangen. Bitte später noch einmal versuchen.";
  return "Die Anfrage hat nicht geklappt.";
}

// --- Typen der API (Ausschnitt, siehe openapi/auth.json und openapi/admin.json) ---

export interface ShopOfUser {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly role: string;
}

export interface CurrentSession {
  readonly user: { readonly id: string; readonly email: string };
  readonly shops: readonly ShopOfUser[];
  readonly secondFactor: "required" | "verified" | "not_enrolled";
  /** Aktives Betreiberkonto (Plattform-Verwaltung, M8). */
  readonly platformOperator: boolean;
}

export interface ProductImage {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface Product {
  readonly id: string;
  readonly status: "draft" | "published";
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly taxClass: "standard" | "reduced";
  readonly price: { readonly amount: number; readonly currency: "EUR" } | null;
  /** Angebotspreis; gesetzt verkauft der Shop dazu und streicht `price` durch. */
  readonly salePrice: { readonly amount: number; readonly currency: "EUR" } | null;
  readonly stock: number;
  readonly categoryId: string | null;
  readonly sku: string | null;
  /** Lieferzeit in Werktagen oder null. */
  readonly deliveryDays?: { readonly min: number; readonly max: number } | null;
  readonly images: readonly ProductImage[];
  readonly version: number;
}

/** Bild des Logos (Shop-Editor Teil 1). */
export interface DesignImage {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
}

/** Inhalt der Startseite (Shop-Editor Teil 2). */
export interface DesignHome {
  readonly heroImage: DesignImage | null;
  readonly heroTitle: string;
  readonly heroText: string;
  readonly featuredProductIds: readonly string[];
  readonly showCategories: boolean;
  /** Abschnitt „Neu im Shop“ (ältere API-Stände ohne). */
  readonly showNew?: boolean;
  /** Bausteine in Reihenfolge (Baukasten); null = alte feste Reihenfolge. */
  readonly blocks?: readonly import("./blocks.js").Block[] | null;
  /** Bilder, die Bausteine benutzen. */
  readonly blockImages?: readonly DesignImage[];
}

export interface Design {
  readonly accentColor: string;
  readonly font: "klassisch" | "modern" | "freundlich";
  readonly logo: DesignImage | null;
  readonly home: DesignHome;
  /** Text unter dem Logo (Teil 3). */
  readonly tagline: string;
  readonly footer: DesignFooter;
}

/** Fußzeile (Shop-Editor Teil 3). */
export interface DesignFooter {
  readonly text: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
}

/** Aussehen des Shops: Entwurf im Editor und was der Shop gerade zeigt. */
export interface DesignState {
  readonly draft: Design;
  readonly published: Design;
  readonly hasUnpublishedChanges: boolean;
  readonly publishedAt: string | null;
  readonly version: number;
}

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly position: number;
  /** Im Shop sichtbar. */
  readonly visible: boolean;
  /** Bild für Kachel und Kategorieseite. */
  readonly image?: ProductImage | null;
  readonly version: number;
}

export interface CategoryInput {
  name?: string;
  description?: string | null;
  position?: number;
  visible?: boolean;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly page: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

export interface ProductInput {
  name: string;
  description: string | null;
  price: { amount: number };
  salePrice: { amount: number } | null;
  taxClass: "standard" | "reduced";
  stock: number;
  categoryId: string | null;
  sku: string | null;
  deliveryDays: { min: number; max: number } | null;
  status: "draft" | "published";
}

/** Alle Seiten einer Liste holen (für das MVP reichen wenige Seiten). */
export async function listAll<T>(path: string, shopId: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url: string = `${path}${sep}limit=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const page: Page<T> = await request<Page<T>>(url, { shopId });
    out.push(...page.data);
    cursor = page.page.nextCursor;
    if (cursor === null) break;
  }
  return out;
}

/** Datei als Base64 ohne „data:…;base64,“ davor. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Datei nicht lesbar"));
    reader.readAsDataURL(file);
  });
}

export type OrderStatus = "pending_payment" | "open" | "in_progress" | "completed" | "cancelled";

export interface OrderSummary {
  readonly id: string;
  readonly orderNumber: string;
  readonly placedAt: string;
  readonly customerName: string;
  readonly email: string;
  readonly total: number;
  readonly itemCount: number;
  readonly status: OrderStatus;
  readonly paymentStatus: string;
  readonly fulfillmentStatus: string;
}

export interface Order {
  readonly id: string;
  readonly orderNumber: string;
  readonly placedAt: string;
  readonly status: OrderStatus;
  readonly paymentStatus: string;
  readonly fulfillmentStatus: string;
  readonly email: string;
  readonly address: {
    readonly firstName: string;
    readonly lastName: string;
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
    readonly countryCode: string;
  };
  readonly subtotal: number;
  /** Rabatt durch Gutschein (Cent) und Code. */
  readonly discount?: number;
  readonly couponCode?: string | null;
  readonly shipping: number;
  readonly tax: number;
  readonly total: number;
  readonly taxByRate: Readonly<Record<string, number>>;
  readonly paymentMethodName: string | null;
  /** Anmerkung der Kundin aus der Kasse. */
  readonly customerNote?: string | null;
  /** Interne Notiz des Shops. */
  readonly merchantNote?: string | null;
  readonly lines: readonly {
    readonly position: number;
    readonly productId: string;
    readonly name: string;
    readonly sku: string | null;
    readonly quantity: number;
    readonly unitPrice: number;
    readonly lineTotal: number;
    readonly taxRatePercent: number;
  }[];
}

// --- Plattform-Verwaltung (M8, openapi/platform.json) ---

export type OperatorRole = "owner" | "operator" | "support" | "viewer";

export interface PlatformShop {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly status: "provisioning" | "active" | "suspended" | "deleting" | "deleted";
  readonly ownerEmail: string | null;
  readonly createdAt: string;
}

export interface CreatedPlatformShop extends PlatformShop {
  readonly invitationSent: boolean;
  readonly invitationExpiresAt: string | null;
}

export interface TwoFactorSetup {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly backupCodes: readonly string[];
}

/** Alle Seiten einer Liste ohne Shop (Platform-API). */
export async function listAllPlatform<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const url: string = `${path}?limit=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const page: Page<T> = await request<Page<T>>(url);
    out.push(...page.data);
    cursor = page.page.nextCursor;
    if (cursor === null) break;
  }
  return out;
}
