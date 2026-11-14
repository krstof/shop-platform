// Versandkosten im Backoffice (API /admin/v1/shipping): Formular lesen und prüfen.
import { centsToInput, parseEuro } from "./money.js";

export interface ShippingSettings {
  readonly amount: number;
  readonly freeFrom: number | null;
  readonly currency: "EUR";
}

export interface ShippingForm {
  amount: string;
  freeFrom: string;
}

export function shippingForm(s: ShippingSettings): ShippingForm {
  return {
    amount: s.amount === 0 ? "" : centsToInput(s.amount),
    freeFrom: s.freeFrom === null ? "" : centsToInput(s.freeFrom),
  };
}

/** Leere Pauschale = kostenlos; leere Grenze = keine Grenze. */
export function parseShippingForm(
  f: ShippingForm,
):
  | { ok: true; body: { amount: number; freeFrom: number | null } }
  | { ok: false; errors: Partial<Record<keyof ShippingForm, string>> } {
  const errors: Partial<Record<keyof ShippingForm, string>> = {};
  const amount = f.amount.trim() === "" ? 0 : parseEuro(f.amount);
  const freeFrom = f.freeFrom.trim() === "" ? null : parseEuro(f.freeFrom);
  if (amount === undefined) errors.amount = "Bitte einen Betrag wie 4,90 angeben oder leer lassen.";
  else if (amount > 100_000) errors.amount = "Höchstens 1.000 €.";
  if (freeFrom === undefined || freeFrom === 0)
    errors.freeFrom = "Bitte einen Betrag wie 50,00 angeben oder leer lassen.";
  else if (freeFrom !== null && amount === 0)
    errors.freeFrom = "Ohne Versandkosten braucht es keine Grenze. Bitte leer lassen.";
  if (amount === undefined || freeFrom === undefined || Object.keys(errors).length > 0)
    return { ok: false, errors };
  return { ok: true, body: { amount, freeFrom } };
}

/** Kurzer Satz, wie der Shop es Kundinnen zeigt. */
export function shippingSummary(
  amount: number,
  freeFrom: number | null,
  euro: (c: number) => string,
): string {
  if (amount === 0) return "Versand ist immer kostenlos.";
  return freeFrom === null
    ? `Jede Bestellung kostet ${euro(amount)} Versand.`
    : `Bestellungen unter ${euro(freeFrom)} kosten ${euro(amount)} Versand, ab ${euro(freeFrom)} ist er kostenlos.`;
}
