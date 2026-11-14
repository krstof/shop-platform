// Gutscheincodes: Rechenregeln ohne Datenbank.

export interface Coupon {
  readonly id: string;
  readonly code: string;
  readonly kind: "percent" | "amount";
  /** Prozent (1 bis 100) oder Cent. */
  readonly value: number;
  /** Mindestwarenwert in Cent; `null` = ohne. */
  readonly minOrderAmount: number | null;
  readonly active: boolean;
}

/** Eingabe der Kundin → gespeicherte Form (Großbuchstaben, ohne Leerraum). `undefined`: kein gültiger Code. */
export function normalizeCode(input: string): string | undefined {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code) ? code : undefined;
}

export type CouponCheck =
  | { readonly ok: true; readonly discount: number }
  | {
      readonly ok: false;
      readonly reason: "unknown" | "inactive" | "min_order";
      readonly minOrderAmount?: number;
    };

/** Rabatt in Cent für einen Warenwert; nie mehr als der Warenwert. */
export function checkCoupon(coupon: Coupon | undefined, subtotal: number): CouponCheck {
  if (coupon === undefined) return { ok: false, reason: "unknown" };
  if (!coupon.active) return { ok: false, reason: "inactive" };
  if (coupon.minOrderAmount !== null && subtotal < coupon.minOrderAmount)
    return { ok: false, reason: "min_order", minOrderAmount: coupon.minOrderAmount };
  const raw = coupon.kind === "percent" ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  return { ok: true, discount: Math.max(0, Math.min(raw, subtotal)) };
}
