import { describe, expect, it } from "vitest";
import { parseShippingForm, shippingForm, shippingSummary } from "./shipping.js";

describe("Versandkosten-Formular", () => {
  it("liest Beträge; leer heißt kostenlos bzw. keine Grenze", () => {
    expect(parseShippingForm({ amount: "4,90", freeFrom: "50" })).toEqual({
      ok: true,
      body: { amount: 490, freeFrom: 5000 },
    });
    expect(parseShippingForm({ amount: "", freeFrom: "" })).toEqual({
      ok: true,
      body: { amount: 0, freeFrom: null },
    });
  });
  it("meldet Fehler", () => {
    expect(parseShippingForm({ amount: "viel", freeFrom: "" }).ok).toBe(false);
    const r = parseShippingForm({ amount: "", freeFrom: "50" });
    expect(r.ok === false && r.errors.freeFrom).toContain("keine Grenze");
    expect(parseShippingForm({ amount: "2000", freeFrom: "" }).ok).toBe(false);
  });
  it("Formular aus gespeicherten Werten und Satz für die Vorschau", () => {
    expect(shippingForm({ amount: 490, freeFrom: null, currency: "EUR" })).toEqual({
      amount: "4,90",
      freeFrom: "",
    });
    const e = (c: number) => `${c / 100} €`;
    expect(shippingSummary(0, null, e)).toBe("Versand ist immer kostenlos.");
    expect(shippingSummary(490, 5000, e)).toBe(
      "Bestellungen unter 50 € kosten 4.9 € Versand, ab 50 € ist er kostenlos.",
    );
  });
});
