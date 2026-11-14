import { describe, expect, it } from "vitest";
import { couponLabel, parseCouponForm } from "./coupons.js";

describe("Gutschein-Formular", () => {
  it("Prozent und fester Betrag", () => {
    expect(parseCouponForm({ code: " sommer10 ", kind: "percent", value: "10", minOrder: "" })).toEqual({
      ok: true,
      body: { code: "SOMMER10", kind: "percent", value: 10, minOrderAmount: null },
    });
    expect(parseCouponForm({ code: "FEST5", kind: "amount", value: "5,00", minOrder: "30" })).toEqual({
      ok: true,
      body: { code: "FEST5", kind: "amount", value: 500, minOrderAmount: 3000 },
    });
  });
  it("meldet Fehler", () => {
    const r = parseCouponForm({ code: "x", kind: "percent", value: "150", minOrder: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["code", "minOrder", "value"]);
    expect(parseCouponForm({ code: "OK1", kind: "percent", value: "7.5", minOrder: "" }).ok).toBe(false);
  });
  it("Kurzbeschreibung", () => {
    const e = (c: number) => `${(c / 100).toFixed(2)} €`;
    expect(couponLabel({ kind: "percent", value: 10, minOrderAmount: null }, e)).toBe("10 % Rabatt");
    expect(couponLabel({ kind: "amount", value: 500, minOrderAmount: 3000 }, e)).toBe(
      "5.00 € Rabatt ab 30.00 € Warenwert",
    );
  });
});
