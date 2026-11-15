// Plattform-Kennzahlen zusammenrechnen: Tage über alle Shops addieren, Werte je Shop, Zahl der Shops.
import { describe, expect, it } from "vitest";
import { combineStats } from "./platform.js";

const day = (date: string, orders: number, revenue: number) => ({ date, orders, revenue });

describe("combineStats", () => {
  it("addiert Tage und Aufgaben über alle Shops, heute ist der letzte Tag", () => {
    const r = combineStats(
      [
        { id: "a", status: "active" },
        { id: "b", status: "suspended" },
      ],
      [
        { days: [day("2026-11-14", 1, 500), day("2026-11-15", 2, 1500)], toShip: 2, awaitingPayment: 1 },
        { days: [day("2026-11-14", 0, 0), day("2026-11-15", 1, 300)], toShip: 0, awaitingPayment: 3 },
      ],
      false,
    );
    expect(r).toMatchObject({ shops: 2, activeShops: 1, suspendedShops: 1, toShip: 2, awaitingPayment: 4 });
    expect(r.days).toEqual([day("2026-11-14", 1, 500), day("2026-11-15", 3, 1800)]);
    expect(r.perShop).toEqual([
      { id: "a", ordersToday: 2, revenueToday: 1500, orders7d: 3, revenue7d: 2000, toShip: 2 },
      { id: "b", ordersToday: 1, revenueToday: 300, orders7d: 1, revenue7d: 300, toShip: 0 },
    ]);
  });

  it("ohne Shops nur Nullen", () => {
    expect(combineStats([], [], false)).toMatchObject({ shops: 0, days: [], perShop: [], toShip: 0 });
  });
});
