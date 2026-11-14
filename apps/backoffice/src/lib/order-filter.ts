// Suche und Filter der Bestellliste (wie bei Produkten): Die Filter stehen in der Adresse
// (/teeladen/bestellungen?suche=…&stand=…), damit „Zurück“ und ein geteilter Link dieselbe Ansicht
// zeigen. Unbekannte oder kaputte Werte werden still ignoriert.

export type OrderStateFilter = "zahlung" | "versenden" | "versendet";

export interface OrderFilter {
  suche?: string;
  stand?: OrderStateFilter;
}

/** Stand in Händlersprache → Status der API. */
const API_STATUS: Record<OrderStateFilter, string> = {
  zahlung: "pending_payment",
  versenden: "open",
  versendet: "completed",
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
  if (raw.stand === "zahlung" || raw.stand === "versenden" || raw.stand === "versendet")
    out.stand = raw.stand;
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
