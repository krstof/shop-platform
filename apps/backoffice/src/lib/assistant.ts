// KI-Assistent im Backoffice (Welle 2). Das Sprachmodell schlägt Werkzeugaufrufe vor; dieses Modul
// führt sie mit der Sitzung des Händlers über die normale Admin-API aus (dieselben Rechte wie jede
// Seite des Backoffice). Ändernde Werkzeuge laufen erst nach Bestätigung (pages/assistant.tsx).
import {
  ApiError,
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
  taxClass: p.taxClass,
  stock: p.stock,
  status: p.status,
  categoryId: p.categoryId,
  sku: p.sku,
});

/** Werkzeugaufruf über die Admin-API. Fehler der API gehen als Text an das Modell zurück. */
export async function runTool(
  name: string,
  input: Readonly<Record<string, unknown>>,
  shopId: string,
): Promise<ToolOutcome> {
  try {
    const result = await run(name, input, shopId);
    return { content: JSON.stringify(result).slice(0, 30_000), isError: false };
  } catch (e) {
    const message =
      e instanceof ApiError
        ? `${e.message}${e.errors.length > 0 ? ` (${e.errors.map((x) => `${x.path}: ${x.message}`).join("; ")})` : ""}`
        : "Unbekannter Fehler";
    return { content: message, isError: true };
  }
}

async function run(name: string, input: Readonly<Record<string, unknown>>, shopId: string): Promise<unknown> {
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
      return { created: compactProduct(p) };
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
    default:
      throw new ApiError(400, "unknown_tool", `Das Werkzeug „${name}“ gibt es nicht.`);
  }
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
      return { title: "Produkt anlegen", lines };
    case "update_product":
      add("Neuer Name", str(input["name"]));
      add("Neuer Preis", price === undefined ? undefined : formatEuro(price));
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
      } as Record<string, string>
    )[name] ?? name
  );
}
