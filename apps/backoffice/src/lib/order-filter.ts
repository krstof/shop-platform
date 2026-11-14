// Suche und Filter der Bestellliste (wie bei Produkten): Die Filter stehen in der Adresse
// (/teeladen/bestellungen?suche=…&stand=…), damit „Zurück“ und ein geteilter Link dieselbe Ansicht
// zeigen. Unbekannte oder kaputte Werte werden still ignoriert.

export type OrderStateFilter = "zahlung" | "versenden" | "versendet" | "storniert";

export interface OrderFilter {
  suche?: string;
  stand?: OrderStateFilter;
}

/** Stand in Händlersprache → Status der API. */
const API_STATUS: Record<OrderStateFilter, string> = {
  zahlung: "pending_payment",
  versenden: "open",
  versendet: "completed",
  storniert: "cancelled",
};

const MAX_SEARCH = 100;
// eslint-disable-next-line no-control-regex -- genau diese Zeichen sollen entfernt werden
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Liest die Filter aus den Suchparametern der Adresse. */
export function parseOrderFilter(raw: Record<string, unknown>): OrderFilter {
  const out: OrderFilter = {};
  // Eine reine Zahl (Bestellnummer) kommt aus der Adresse als number an.
  const suche = typeof raw.suche === "number" ? String(raw.suche) : raw.suche;
  if (typeof suche === "string") {
    const text = suche.replace(CONTROL, " ").trim().slice(0, MAX_SEARCH).trim();
    if (text !== "") out.suche = text;
  }
  if (typeof raw.stand === "string" && Object.hasOwn(API_STATUS, raw.stand))
    out.stand = raw.stand as OrderStateFilter;
  return out;
}

/** Ist irgendein Filter gesetzt? */
export function isOrderFiltered(f: OrderFilter): boolean {
  return f.suche !== undefined || f.stand !== undefined;
}

/** Adresse der Admin-API für die gefilterte Liste. */
export function orderListPath(f: OrderFilter): string {
  const params = new URLSearchParams();
  if (f.suche !== undefined) params.set("q", f.suche);
  if (f.stand !== undefined) params.set("status", API_STATUS[f.stand]);
  const qs = params.toString();
  return qs === "" ? "/admin/v1/orders" : `/admin/v1/orders?${qs}`;
}

/** Eine Zelle für CSV (Semikolon, wie deutsches Excel es erwartet). Formeln werden entschärft. */
export function csvCell(value: string | number): string {
  let text = String(value);
  // Zellen, die mit = + - @ beginnen, würde eine Tabellenkalkulation als Formel ausführen.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Bestellungen als CSV-Text (mit BOM, damit Excel Umlaute richtig liest). */
export function ordersCsv(
  orders: readonly {
    orderNumber: string;
    placedAt: string;
    customerName: string;
    email: string;
    itemCount: number;
    total: number;
    status: string;
    paymentStatus: string;
  }[],
  stateText: (o: { status: string; paymentStatus: string }) => string,
): string {
  const date = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  const rows = [
    ["Bestellnummer", "Datum", "Kunde", "E-Mail", "Artikel", "Summe (EUR)", "Stand"],
    ...orders.map((o) => [
      o.orderNumber,
      date.format(new Date(o.placedAt)),
      o.customerName,
      o.email,
      o.itemCount,
      (o.total / 100).toFixed(2).replace(".", ","),
      stateText(o),
    ]),
  ];
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
