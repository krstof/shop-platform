import { describe, expect, it } from "vitest";
import { FREE_SHIPPING, quoteFor } from "./rules.js";

describe("quoteFor", () => {
  it("ohne Einstellung immer kostenlos", () => {
    expect(quoteFor(1990, FREE_SHIPPING)).toEqual({ name: "Standardversand (kostenlos)", amount: 0 });
  });
  it("Pauschale, ab Grenze kostenlos (genau an der Grenze schon kostenlos)", () => {
    const s = { amount: 490, freeFrom: 5000 };
    expect(quoteFor(4999, s)).toEqual({ name: "Standardversand", amount: 490 });
    expect(quoteFor(5000, s).amount).toBe(0);
    expect(quoteFor(9000, s).amount).toBe(0);
  });
  it("Pauschale ohne Grenze; leerer Warenkorb kostet nichts", () => {
    expect(quoteFor(100_000, { amount: 590, freeFrom: null }).amount).toBe(590);
    expect(quoteFor(0, { amount: 590, freeFrom: null }).amount).toBe(0);
  });
});
