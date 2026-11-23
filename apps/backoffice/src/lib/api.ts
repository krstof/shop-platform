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

/**
 * Sitzung abgelaufen (Kristof 22.11.2026): Antwortet die API mit 401, ist die Anmeldung weg. Dann
 * muss die ganze Oberfläche das erfahren, sonst steht oben rechts weiter „Abmelden“, obwohl niemand
 * mehr angemeldet ist. Das Anmelden selbst zählt nicht dazu: Dort heißt 401 „Passwort falsch“.
 */
let onSignedOut: (() => void) | undefined;
export function setSignedOutHandler(fn: () => void): void {
  onSignedOut = fn;
}

const ANMELDE_PFADE = ["/auth/v1/sign-in", "/auth/v1/two-factor/verify", "/auth/v1/session"];

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
  if (response.status === 401 && !ANMELDE_PFADE.some((p) => path.startsWith(p))) onSignedOut?.();
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
  /** Mindestbestand (P5); null = keine Angabe. Ältere Antworten haben das Feld nicht. */
  readonly lowStockThreshold?: number | null;
  /** Neu-Schildchen im Shop (P5). */
  readonly newBadge?: "auto" | "always" | "never";
  /** Eigene Suchwörter, durch Komma getrennt (P5). */
  readonly searchKeywords?: string | null;
  readonly categoryId: string | null;
  /** Alle Kategorien, die Hauptkategorie zuerst (seit 15.11.2026; ältere Antworten ohne). */
  readonly categoryIds?: readonly string[];
  readonly sku: string | null;
  /** Lieferzeit in Werktagen oder null. */
  readonly deliveryDays?: { readonly min: number; readonly max: number } | null;
  readonly images: readonly ProductImage[];
  /** Video am Produkt (P5); ältere Antworten ohne. */
  readonly video?: ProductVideo | null;
  readonly version: number;
}

/** Video am Produkt: eigene Datei im Shop oder ein Video bei YouTube oder Vimeo. */
export interface ProductVideo {
  readonly kind: "file" | "youtube" | "vimeo";
  /** Bei `file` die Datei zum Abspielen, sonst die Adresse beim Anbieter. */
  readonly url: string;
  readonly providerId: string | null;
  /** Standbild aus dem Video (nur bei einer eigenen Datei). */
  readonly posterUrl?: string | null;
  readonly posterThumbnailUrl?: string | null;
  readonly autoplay: boolean;
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
  /** Bausteine in Reihenfolge (Baukasten), nur Arten bis 13.11.; null = alte feste Reihenfolge. */
  readonly blocks?: readonly import("./blocks.js").Block[] | null;
  /** Alle Bausteine mit Inhalt der Shop-Bereiche (seit 14.11.2026). */
  readonly content?: readonly import("./blocks.js").Block[] | null;
  /** Bilder, die Bausteine benutzen. */
  readonly blockImages?: readonly DesignImage[];
}

export interface Design {
  readonly accentColor: string;
  readonly font: "klassisch" | "modern" | "freundlich";
  readonly logo: DesignImage | null;
  /** Symbol des Shops (22.11.2026); ältere API-Stände ohne. */
  readonly favicon?: DesignImage | null;
  readonly home: DesignHome;
  /** Text unter dem Logo (Teil 3). */
  readonly tagline: string;
  readonly footer: DesignFooter;
  /** Eigene Inhaltsseiten (ältere API-Stände ohne). */
  readonly pages?: readonly DesignPage[];
  /** Hintergrundfarbe, Google-Schriften (ältere API-Stände ohne). */
  readonly backgroundColor?: string;
  readonly headingFont?: import("./design.js").WebFont | null;
  readonly bodyFont?: import("./design.js").WebFont | null;
  /** Design-Vorlage (Anordnung); ältere API-Stände ohne. */
  readonly template?: string;
  /** Kopfzeile (22.11.2026); ältere API-Stände ohne. */
  readonly header?: {
    readonly search?: string;
    readonly sticky?: boolean;
    /** Leiste ganz oben an oder aus. */
    readonly uspOn?: boolean;
    /** Bis zu drei kurze Zusagen in der Leiste. */
    readonly usp?: readonly string[];
  };
}

/** Eigene Inhaltsseite (Baukasten Teil 3). */
export type DesignPage = import("./blocks.js").ContentPage & {
  readonly content?: readonly import("./blocks.js").Block[];
  readonly blockImages: readonly DesignImage[];
};

/** Fußzeile (Shop-Editor Teil 3). */
export interface DesignFooter {
  readonly text: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
  /** Profile in sozialen Netzwerken (ältere API-Stände ohne). */
  readonly social?: Readonly<Record<string, string | undefined>>;
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
  /** Mindestbestand (P5); null nimmt die Angabe weg. */
  lowStockThreshold: number | null;
  /** Neu-Schildchen im Shop (P5). */
  newBadge: "auto" | "always" | "never";
  /** Eigene Suchwörter, durch Komma getrennt (P5); null nimmt sie weg. */
  searchKeywords: string | null;
  /** Adresse eines Videos bei YouTube oder Vimeo; null nimmt das Video weg (auch eine Datei). */
  videoUrl?: string | null;
  /** Video startet im Shop von selbst, immer ohne Ton. */
  videoAutoplay?: boolean;
  /** Alle Kategorien, die erste ist die Hauptkategorie. */
  categoryIds: string[];
  sku: string | null;
  deliveryDays: { min: number; max: number } | null;
  status: "draft" | "published";
}

/** Kategorien eines Produkts, auch bei älteren Antworten nur mit `categoryId`. */
export function categoryIdsOf(p: { categoryId: string | null; categoryIds?: readonly string[] }): string[] {
  if (p.categoryIds !== undefined) return [...p.categoryIds];
  return p.categoryId === null ? [] : [p.categoryId];
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

/**
 * Grenze fürs Hochladen: Die API nimmt Bilder bis 8 MB an, Caddy die ganze Anfrage bis 12 MB.
 * Base64 macht aus 3 Bytes 4 Zeichen, deshalb bleibt bei 7,5 MB Datei genug Luft für den Rest.
 */
const UPLOAD_PASS_THROUGH_BYTES = 7_500_000;

/** Lange Kante, auf die ein zu großes Bild verkleinert wird. Für Bühnenbilder reichlich. */
const UPLOAD_MAX_EDGE = 2400;

/**
 * Bereitet ein Bild zum Hochladen vor (21.11.2026). Kleine Bilder gehen unverändert hinaus, große
 * verkleinert der Browser vorher auf {@link UPLOAD_MAX_EDGE} und schreibt sie als WebP (behält
 * Transparenz, etwa bei einem Logo). Vorher scheiterte jedes größere Foto an „Die Anfrage ist zu groß“.
 */
export async function imageUploadData(file: File | Blob): Promise<{ data: string; filename: string }> {
  const name = file instanceof File && file.name !== "" ? file.name : "bild";
  if (file.size <= UPLOAD_PASS_THROUGH_BYTES) return { data: await fileToBase64(file), filename: name };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Bild konnte nicht verkleinert werden");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const base = name.replace(/\.[^.]+$/, "");
  for (const quality of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob === null) continue;
    const data = await fileToBase64(blob);
    if (data.length <= 10_000_000 || quality === 0.7) return { data, filename: `${base}.webp` };
  }
  throw new Error("Bild konnte nicht verkleinert werden");
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

/** Kennzahlen aller Shops (GET /platform/v1/stats). Beträge in Cent. */
export interface PlatformStats {
  readonly currency: "EUR";
  readonly shops: number;
  readonly activeShops: number;
  readonly suspendedShops: number;
  readonly days: readonly { readonly date: string; readonly orders: number; readonly revenue: number }[];
  readonly toShip: number;
  readonly awaitingPayment: number;
  readonly perShop: readonly {
    readonly id: string;
    readonly ordersToday: number;
    readonly revenueToday: number;
    readonly orders7d: number;
    readonly revenue7d: number;
    readonly toShip: number;
  }[];
  readonly truncated: boolean;
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

/**
 * Standbild aus einem Video holen (Paket P5, Kristof 23.11.2026): Das Video wird nur im Browser
 * geladen, eine Sekunde vorgespult und das Bild auf eine Leinwand gezeichnet. So entsteht das
 * Vorschaubild ohne jedes Werkzeug auf dem Server. Klappt es nicht (seltenes Format, kein Bild),
 * kommt `undefined` zurück und der Upload läuft trotzdem.
 */
export function videoVorschaubild(file: Blob): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let fertig = false;
    const aufgeben = () => {
      if (fertig) return;
      fertig = true;
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    const abholen = () => {
      if (fertig) return;
      try {
        const breite = video.videoWidth;
        const hoehe = video.videoHeight;
        if (breite === 0 || hoehe === 0) return aufgeben();
        const canvas = document.createElement("canvas");
        const faktor = Math.min(1, 1600 / Math.max(breite, hoehe));
        canvas.width = Math.round(breite * faktor);
        canvas.height = Math.round(hoehe * faktor);
        const ctx = canvas.getContext("2d");
        if (ctx === null) return aufgeben();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const daten = canvas.toDataURL("image/jpeg", 0.85);
        fertig = true;
        URL.revokeObjectURL(url);
        resolve(daten.slice(daten.indexOf(",") + 1));
      } catch {
        aufgeben();
      }
    };
    video.addEventListener("error", aufgeben);
    video.addEventListener("loadeddata", () => {
      // Eine Sekunde hinein: Der allererste Bildpunkt ist oft noch schwarz.
      if (video.duration > 1.2) video.currentTime = 1;
      else abholen();
    });
    video.addEventListener("seeked", abholen);
    setTimeout(aufgeben, 10_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
  });
}
