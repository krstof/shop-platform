import { describe, expect, it } from "vitest";
import type { Product } from "../lib/api.js";
import { dayLabel, lowStock, soldOut } from "./overview.js";

const p = (name: string, stock: number, status: Product["status"] = "published") =>
  ({ id: name, name, stock, status }) as unknown as Product;

describe("Übersicht", () => {
  it("beschriftet Tage auf Deutsch", () => {
    expect(dayLabel("2026-11-14")).toEqual({ weekday: "Sa", day: "14.11." });
  });

  it("zeigt knappe, aber nicht ausverkaufte Produkte im Shop; ausverkaufte nur als Zahl", () => {
    const list = [
      p("Sencha", 3),
      p("Matcha", 0),
      p("Earl Grey", 40),
      p("Entwurf", 0, "draft"),
      p("Assam", 5),
    ];
    expect(lowStock(list).map((x) => x.name)).toEqual(["Sencha", "Assam"]);
    expect(lowStock(list, 1)).toHaveLength(1);
    expect(soldOut(list)).toBe(1);
  });
});
