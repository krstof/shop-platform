// KI-Assistent im Backoffice (Welle 2). Das Sprachmodell schlägt Werkzeugaufrufe vor; dieses Modul
// führt sie mit der Sitzung des Händlers über die normale Admin-API aus (dieselben Rechte wie jede
// Seite des Backoffice). Ändernde Werkzeuge laufen erst nach Bestätigung (pages/assistant.tsx).
import {
  ApiError,
  fileToBase64,
  listAll,
  request,
  type Category,
  type Order,
  type OrderSummary,
  type Product,
} from "./api.js";
import { formatEuro } from "./money.js";
import { orderListPath, type OrderStateFilter } from "./order-filter.js";
import { productListPath } from "./product-filter.js";

export type ChatBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | {
      /** Foto der Person, verkleinert (lange Kante 1024 px) als Base64. */
      readonly type: "image";
      readonly source: {
        readonly type: "base64";
        readonly media_type: "image/jpeg" | "image/png" | "image/webp";
        readonly data: string;
      };
    }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
      readonly is_error?: boolean;
    };

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly ChatBlock[];
}

export interface AssistantStatus {
  readonly available: boolean;
  readonly model: string | null;
  readonly dailyLimit: number;
  readonly usedToday: number;
  readonly tools: readonly { readonly name: string; readonly changes: boolean }[];
}

export interface ToolOutcome {
  readonly content: string;
  readonly isError: boolean;
}

/** Ändernde Werkzeuge: nur nach Bestätigung. Fällt der Server aus, gilt im Zweifel „ändert“. */
export function needsConfirmation(name: string, status: AssistantStatus | undefined): boolean {
  const tool = status?.tools.find((t) => t.name === name);
  return tool === undefined ? true : tool.changes;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) ? v : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const TAX = (v: unknown): "standard" | "reduced" | undefined =>
  v === "standard" || v === "reduced" ? v : undefined;

const STATE: Record<string, OrderStateFilter> = {
  awaiting_payment: "zahlung",
  to_ship: "versenden",
  shipped: "versendet",
};

const compactProduct = (p: Product) => ({
  id: p.id,
  name: p.name,
  priceCents: p.price?.amount ?? null,
  salePriceCents: p.salePrice?.amount ?? null,
  taxClass: p.taxClass,
  stock: p.stock,
  status: p.status,
  categoryId: p.categoryId,
  sku: p.sku,
});

/** Werkzeugaufruf über die Admin-API. Fehler der API gehen als Text an das Modell zurück. */
/** Fotos aus dem Chat in voller Größe (Kennung „foto-1“ → Datei), nur solange die Seite offen ist. */
export type PhotoStore = ReadonlyMap<string, Blob>;

export async function runTool(
  name: string,
  input: Readonly<Record<string, unknown>>,
  shopId: string,
  photos: PhotoStore = new Map(),
): Promise<ToolOutcome> {
  try {
    const result = await run(name, input, shopId, photos);
    return { content: JSON.stringify(result).slice(0, 30_000), isError: false };
  } catch (e) {
    const message =
      e instanceof ApiError
        ? `${e.message}${e.errors.length > 0 ? ` (${e.errors.map((x) => `${x.path}: ${x.message}`).join("; ")})` : ""}`
        : "Unbekannter Fehler";
    return { content: message, isError: true };
  }
}

/** Lädt ein Foto aus dem Chat als Produktbild hoch. */
async function uploadPhoto(productId: string, photoId: string, shopId: string, photos: PhotoStore) {
  const file = photos.get(photoId);
  if (file === undefined)
    throw new ApiError(
      400,
      "photo_missing",
      `Das Foto ${photoId} ist nicht mehr da (Seite neu geladen?). Bitte noch einmal schicken.`,
    );
  return request<Product>(`/admin/v1/products/${encodeURIComponent(productId)}/images`, {
    method: "POST",
    shopId,
    body: { data: await fileToBase64(file), filename: `${photoId}.${extensionOf(file.type)}` },
  });
}

function extensionOf(type: string): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

async function run(
  name: string,
  input: Readonly<Record<string, unknown>>,
  shopId: string,
  photos: PhotoStore,
): Promise<unknown> {
  switch (name) {
    case "list_categories": {
      const cats = await listAll<Category>("/admin/v1/categories", shopId);
      return cats.map((c) => ({ id: c.id, name: c.name, visible: c.visible }));
    }
    case "search_products": {
      const status =
        input["status"] === "draft" ? "entwurf" : input["status"] === "published" ? "sichtbar" : undefined;
      const suche = str(input["query"]);
      const list = await listAll<Product>(
        productListPath({
          ...(suche === undefined ? {} : { suche }),
          ...(status === undefined ? {} : { status }),
        }),
        shopId,
      );
      return { count: list.length, products: list.slice(0, 50).map(compactProduct) };
    }
    case "create_product": {
      const p = await request<Product>("/admin/v1/products", {
        method: "POST",
        shopId,
        body: productBody(input, true),
      });
      const photo = str(input["photo"]);
      if (photo === undefined) return { created: compactProduct(p) };
      // Das Produkt gibt es jetzt; scheitert nur das Bild, sagt das Ergebnis es dem Modell.
      try {
        await uploadPhoto(p.id, photo, shopId, photos);
        return { created: compactProduct(p), photoAdded: true };
      } catch (e) {
        return {
          created: compactProduct(p),
          photoAdded: false,
          photoError: e instanceof ApiError ? e.message : "Foto konnte nicht hochgeladen werden",
        };
      }
    }
    case "copy_product": {
      const id = str(input["productId"]) ?? "";
      const p = await request<Product>(`/admin/v1/products/${encodeURIComponent(id)}/copy`, {
        method: "POST",
        shopId,
      });
      return { created: compactProduct(p) };
    }
    case "add_product_photo": {
      const p = await uploadPhoto(str(input["productId"]) ?? "", str(input["photo"]) ?? "", shopId, photos);
      return { updated: compactProduct(p), images: p.images.length };
    }
    case "update_product": {
      const id = str(input["productId"]) ?? "";
      const current = await request<Product>(`/admin/v1/products/${encodeURIComponent(id)}`, { shopId });
      const p = await request<Product>(`/admin/v1/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        shopId,
        version: current.version,
        body: productBody(input, false),
      });
      return { updated: compactProduct(p) };
    }
    case "create_category": {
      const description = str(input["description"]);
      const c = await request<Category>("/admin/v1/categories", {
        method: "POST",
        shopId,
        body: { name: str(input["name"]) ?? "", ...(description === undefined ? {} : { description }) },
      });
      return { created: { id: c.id, name: c.name } };
    }
    case "search_orders": {
      const suche = str(input["query"]);
      const stand = STATE[String(input["state"])];
      const list = await listAll<OrderSummary>(
        orderListPath({
          ...(suche === undefined ? {} : { suche }),
          ...(stand === undefined ? {} : { stand }),
        }),
        shopId,
      );
      return {
        count: list.length,
        orders: list.slice(0, 30).map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          placedAt: o.placedAt,
          customerName: o.customerName,
          totalCents: o.total,
          items: o.itemCount,
          status: o.status,
          paymentStatus: o.paymentStatus,
          fulfillmentStatus: o.fulfillmentStatus,
        })),
      };
    }
    case "get_order":
      return request<Order>(`/admin/v1/orders/${encodeURIComponent(str(input["orderId"]) ?? "")}`, {
        shopId,
      });
    case "mark_order_shipped": {
      const o = await request<Order>(
        `/admin/v1/orders/${encodeURIComponent(str(input["orderId"]) ?? "")}/ship`,
        {
          method: "POST",
          shopId,
        },
      );
      return { shipped: { id: o.id, orderNumber: o.orderNumber, status: o.status } };
    }
    case "cancel_order": {
      const o = await request<Order>(
        `/admin/v1/orders/${encodeURIComponent(str(input["orderId"]) ?? "")}/cancel`,
        { method: "POST", shopId },
      );
      return {
        cancelled: { id: o.id, orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus },
      };
    }
    case "set_order_note": {
      const note = (str(input["note"]) ?? "").trim();
      const o = await request<Order>(
        `/admin/v1/orders/${encodeURIComponent(str(input["orderId"]) ?? "")}/note`,
        {
          method: "PUT",
          shopId,
          body: { note: note === "" ? null : note },
        },
      );
      return { updated: { id: o.id, orderNumber: o.orderNumber, merchantNote: o.merchantNote ?? null } };
    }
    case "get_shipping":
      return request("/admin/v1/shipping", { shopId });
    case "update_shipping":
      return request("/admin/v1/shipping", { method: "PUT", shopId, body: shippingBody(input) });
    case "list_coupons":
      return request("/admin/v1/coupons", { shopId });
    case "create_coupon":
      return request("/admin/v1/coupons", { method: "POST", shopId, body: couponBody(input) });
    default:
      throw new ApiError(400, "unknown_tool", `Das Werkzeug „${name}“ gibt es nicht.`);
  }
}

/** Eingabe des Modells → Inhalt für PUT /admin/v1/shipping. */
export function shippingBody(input: Readonly<Record<string, unknown>>): {
  amount: number;
  freeFrom: number | null;
} {
  const amount = int(input["amountCents"]) ?? 0;
  const freeFrom = int(input["freeFromCents"]);
  return { amount, freeFrom: amount === 0 || freeFrom === undefined ? null : freeFrom };
}

/** Eingabe des Modells → Inhalt für POST /admin/v1/coupons. */
export function couponBody(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const min = int(input["minOrderCents"]);
  return {
    code: str(input["code"]) ?? "",
    kind: input["kind"] === "amount" ? "amount" : "percent",
    value: int(input["value"]) ?? 0,
    ...(min === undefined ? {} : { minOrderAmount: min }),
  };
}

/** Eingabe des Modells → Inhalt für POST/PATCH /admin/v1/products. Nur bekannte Felder. */
export function productBody(
  input: Readonly<Record<string, unknown>>,
  create: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const name = str(input["name"]);
  if (name !== undefined) body["name"] = name;
  const description = str(input["description"]);
  if (description !== undefined) body["description"] = description;
  const price = int(input["priceCents"]);
  if (price !== undefined) body["price"] = { amount: price };
  if (input["salePriceCents"] === null && !create) body["salePrice"] = null;
  const sale = int(input["salePriceCents"]);
  if (sale !== undefined) body["salePrice"] = { amount: sale };
  const tax = TAX(input["taxClass"]);
  if (tax !== undefined) body["taxClass"] = tax;
  const stock = int(input["stock"]);
  if (stock !== undefined) body["stock"] = stock;
  if (input["categoryId"] === null && !create) body["categoryId"] = null;
  const category = str(input["categoryId"]);
  if (category !== undefined) body["categoryId"] = category;
  const published = bool(input["published"]);
  if (published !== undefined) body["status"] = published ? "published" : "draft";
  else if (create) body["status"] = "draft";
  return body;
}

/** Was eine Änderung tun würde, in einfachen Worten (für die Rückfrage im Chat). */
export function describeChange(
  name: string,
  input: Readonly<Record<string, unknown>>,
): { title: string; lines: string[] } {
  const lines: string[] = [];
  const price = int(input["priceCents"]);
  const sale = int(input["salePriceCents"]);
  const tax = TAX(input["taxClass"]);
  const stock = int(input["stock"]);
  const published = bool(input["published"]);
  const add = (label: string, value: string | undefined) => {
    if (value !== undefined) lines.push(`${label}: ${value}`);
  };
  switch (name) {
    case "create_product":
      add("Name", str(input["name"]));
      add("Preis", price === undefined ? undefined : formatEuro(price));
      add("Steuer", tax === undefined ? undefined : tax === "reduced" ? "7 %" : "19 %");
      add("Bestand", stock === undefined ? undefined : String(stock));
      add("Im Shop", published === true ? "ja, sofort sichtbar" : "nein, erst als Entwurf");
      add("Beschreibung", str(input["description"]));
      add("Bild", str(input["photo"]) === undefined ? undefined : "das Foto aus dem Chat");
      return { title: "Produkt anlegen", lines };
    case "add_product_photo":
      return { title: "Foto als Produktbild hinzufügen", lines };
    case "copy_product":
      lines.push("Kopie als Entwurf, Bestand 0, Name mit „(Kopie)“");
      return { title: "Produkt kopieren", lines };
    case "update_product":
      add("Neuer Name", str(input["name"]));
      add("Neuer Preis", price === undefined ? undefined : formatEuro(price));
      add("Angebotspreis", sale === undefined ? undefined : formatEuro(sale));
      if (input["salePriceCents"] === null) lines.push("Angebot beenden");
      add("Steuer", tax === undefined ? undefined : tax === "reduced" ? "7 %" : "19 %");
      add("Neuer Bestand", stock === undefined ? undefined : String(stock));
      add("Im Shop", published === undefined ? undefined : published ? "ja" : "nein, aus dem Shop nehmen");
      if (input["categoryId"] === null) lines.push("Aus der Kategorie nehmen");
      else add("Kategorie", str(input["categoryId"]) === undefined ? undefined : "ändern");
      add("Neue Beschreibung", str(input["description"]));
      return { title: "Produkt ändern", lines };
    case "create_category":
      add("Name", str(input["name"]));
      add("Beschreibung", str(input["description"]));
      return { title: "Kategorie anlegen", lines };
    case "mark_order_shipped":
      return { title: "Bestellung als versendet markieren", lines };
    case "cancel_order":
      lines.push("Ware zurück ins Lager, bezahlte Testzahlung gilt als erstattet");
      return { title: "Bestellung stornieren", lines };
    case "set_order_note": {
      const note = (str(input["note"]) ?? "").trim();
      lines.push(note === "" ? "Notiz löschen" : `Notiz: ${note}`);
      return { title: "Interne Notiz setzen", lines };
    }
    case "update_shipping": {
      const s = shippingBody(input);
      lines.push(s.amount === 0 ? "Versand: kostenlos" : `Versand: ${formatEuro(s.amount)}`);
      if (s.freeFrom !== null) lines.push(`Kostenlos ab ${formatEuro(s.freeFrom)} Warenwert`);
      return { title: "Versandkosten ändern", lines };
    }
    case "create_coupon": {
      const c = couponBody(input);
      add("Code", String(c["code"]).toUpperCase());
      lines.push(
        c["kind"] === "amount"
          ? `Rabatt: ${formatEuro(Number(c["value"]))}`
          : `Rabatt: ${String(c["value"])} %`,
      );
      if (c["minOrderAmount"] !== undefined)
        lines.push(`Ab ${formatEuro(Number(c["minOrderAmount"]))} Warenwert`);
      return { title: "Gutschein anlegen", lines };
    }
    default:
      return { title: `Aktion „${name}“`, lines };
  }
}

/** Kurzer Hinweis für lesende Werkzeuge, solange sie laufen oder danach im Verlauf. */
export function toolLabel(name: string): string {
  return (
    (
      {
        list_categories: "Kategorien angesehen",
        search_products: "Produkte durchsucht",
        search_orders: "Bestellungen durchsucht",
        get_order: "Bestellung gelesen",
        get_shipping: "Versandkosten angesehen",
        list_coupons: "Gutscheine angesehen",
      } as Record<string, string>
    )[name] ?? name
  );
}

/**
 * Was ans Modell geht: Fotos nur aus der letzten Nachricht mit Fotos (spart Kosten und bleibt unter
 * der Größengrenze der Anfrage); ältere Fotos werden zu einem kurzen Hinweis.
 */
export function prepareForSend(messages: readonly ChatMessage[]): ChatMessage[] {
  let lastWithImage = -1;
  messages.forEach((m, i) => {
    if (m.content.some((b) => b.type === "image")) lastWithImage = i;
  });
  return messages.map((m, i) =>
    i === lastWithImage || !m.content.some((b) => b.type === "image")
      ? m
      : {
          ...m,
          content: m.content.map((b) =>
            b.type === "image" ? { type: "text", text: "(Foto, schon angesehen)" } : b,
          ),
        },
  );
}

/** Für den Speicher im Browser-Tab: Fotos durch einen Hinweis ersetzen (sonst wird es zu groß). */
export function stripImages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.content.some((b) => b.type === "image")
      ? { ...m, content: m.content.map((b) => (b.type === "image" ? { type: "text", text: "(Foto)" } : b)) }
      : m,
  );
}

/** Verkleinert ein Foto für das Modell: lange Kante höchstens `maxEdge`, JPEG. Nur im Browser. */
export async function shrinkPhoto(file: Blob, maxEdge = 1024): Promise<{ data: string; blob: Blob }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Kein Zeichenbereich");
  ctx.fillStyle = "#ffffff"; // transparente PNG nicht schwarz werden lassen
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob === null) continue;
    const data = await fileToBase64(blob);
    if (data.length <= 450_000 || quality === 0.55) return { data, blob };
  }
  throw new Error("Foto konnte nicht verkleinert werden");
}

/**
 * Antwortknöpfe (15.11.2026): Endet eine Antwort des Assistenten mit „Antworten: Ja | Nein“, zeigt der
 * Chat diese Zeile als Buttons statt als Text (2 bis 4 kurze Antworten).
 */
export function splitChoices(text: string): { text: string; choices: string[] } {
  const m = /\n?[ \t]*Antworten:[ \t]*([^\n]+?)[ \t]*$/.exec(text.trimEnd());
  if (m === null) return { text, choices: [] };
  const choices = (m[1] ?? "")
    .split("|")
    .map((c) => c.trim().replace(/^[„"“]|[“"”]$/g, ""))
    .filter((c) => c !== "" && c.length <= 40);
  if (choices.length < 2 || choices.length > 4) return { text, choices: [] };
  return { text: text.trimEnd().slice(0, m.index).trimEnd(), choices };
}
