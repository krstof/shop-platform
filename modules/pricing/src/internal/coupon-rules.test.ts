import { describe, expect, it } from "vitest";
import { checkCoupon, normalizeCode, type Coupon } from "./coupon-rules.js";

const c = (over: Partial<Coupon>): Coupon => ({
  id: "1",
  code: "SOMMER10",
  kind: "percent",
  value: 10,
  minOrderAmount: null,
  active: true,
  ...over,
});

describe("Gutscheine", () => {
  it("normalisiert Eingaben", () => {
    expect(normalizeCode(" sommer10 ")).toBe("SOMMER10");
    expect(normalizeCode("tee 2026")).toBe("TEE2026");
    expect(normalizeCode("a")).toBeUndefined();
    expect(normalizeCode("<script>")).toBeUndefined();
    expect(normalizeCode("x".repeat(40))).toBeUndefined();
  });
  it("Prozent und fester Betrag, nie mehr als der Warenwert", () => {
    expect(checkCoupon(c({}), 1990)).toEqual({ ok: true, discount: 199 });
    expect(checkCoupon(c({ value: 100 }), 1990)).toEqual({ ok: true, discount: 1990 });
    expect(checkCoupon(c({ kind: "amount", value: 500 }), 1990)).toEqual({ ok: true, discount: 500 });
    expect(checkCoupon(c({ kind: "amount", value: 5000 }), 1990)).toEqual({ ok: true, discount: 1990 });
  });
  it("unbekannt, abgeschaltet, Mindestwert", () => {
    expect(checkCoupon(undefined, 1000)).toEqual({ ok: false, reason: "unknown" });
    expect(checkCoupon(c({ active: false }), 1000)).toEqual({ ok: false, reason: "inactive" });
    expect(checkCoupon(c({ minOrderAmount: 3000 }), 2999)).toEqual({
      ok: false,
      reason: "min_order",
      minOrderAmount: 3000,
    });
    expect(checkCoupon(c({ minOrderAmount: 3000 }), 3000).ok).toBe(true);
  });
});
