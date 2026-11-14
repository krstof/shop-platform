import { describe, expect, it } from "vitest";
import { allocateDiscount } from "./orders.js";

describe("allocateDiscount", () => {
  it("verteilt anteilig, die Summe stimmt genau", () => {
    expect(allocateDiscount([1000, 3000], 400)).toEqual([100, 300]);
    const r = allocateDiscount([333, 333, 334], 100);
    expect(r.reduce((a, x) => a + x, 0)).toBe(100);
    expect(r).toEqual([33, 33, 34]);
  });
  it("nie mehr als der Warenwert, 0 bleibt 0", () => {
    expect(allocateDiscount([500, 500], 5000)).toEqual([500, 500]);
    expect(allocateDiscount([500], 0)).toEqual([0]);
    expect(allocateDiscount([], 100)).toEqual([]);
  });
});
