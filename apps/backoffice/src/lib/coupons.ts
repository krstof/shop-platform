// Gutscheine im Backoffice (API /admin/v1/coupons): Formular prüfen und Kurzbeschreibung.
import { parseEuro } from "./money.js";

export interface Coupon {
  readonly id: string;
  readonly code: string;
  readonly kind: "percent" | "amount";
  readonly value: number;
  readonly minOrderAmount: number | null;
  readonly active: boolean;
}

export interface CouponForm {
  code: string;
  kind: string;
  value: string;
  minOrder: string;
}

type Body = { code: string; kind: "percent" | "amount"; value: number; minOrderAmount: number | null };

export function parseCouponForm(
  f: CouponForm,
): { ok: true; body: Body } | { ok: false; errors: Partial<Record<keyof CouponForm, string>> } {
  const errors: Partial<Record<keyof CouponForm, string>> = {};
  const code = f.code.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code))
    errors.code = "2 bis 32 Zeichen: Buchstaben, Ziffern und Bindestrich.";
  const kind = f.kind === "amount" ? "amount" : "percent";
  let value: number | undefined;
  if (kind === "percent") {
    const n = Number(f.value.trim().replace(",", "."));
    if (Number.isInteger(n) && n >= 1 && n <= 100) value = n;
    else errors.value = "Bitte eine ganze Zahl von 1 bis 100.";
  } else {
    value = parseEuro(f.value);
    if (value === undefined || value < 1) {
      value = undefined;
      errors.value = "Bitte einen Betrag wie 5,00.";
    }
  }
  const minOrder = f.minOrder.trim() === "" ? null : parseEuro(f.minOrder);
  if (minOrder === undefined || minOrder === 0)
    errors.minOrder = "Bitte einen Betrag wie 30,00 oder leer lassen.";
  if (Object.keys(errors).length > 0 || value === undefined || minOrder === undefined)
    return { ok: false, errors };
  return { ok: true, body: { code, kind, value, minOrderAmount: minOrder } };
}

/** „10 % Rabatt“, „5,00 € Rabatt ab 30,00 €“. */
export function couponLabel(
  c: Pick<Coupon, "kind" | "value" | "minOrderAmount">,
  euro: (c: number) => string,
): string {
  const base = c.kind === "percent" ? `${c.value} % Rabatt` : `${euro(c.value)} Rabatt`;
  return c.minOrderAmount === null ? base : `${base} ab ${euro(c.minOrderAmount)} Warenwert`;
}
