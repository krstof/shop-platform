import { describe, expect, it } from "vitest";
import { filterCustomers, type CustomerSummary } from "./customers.js";

const c = (name: string, email: string): CustomerSummary => ({
  name,
  email,
  orderCount: 1,
  revenue: 0,
  firstOrderAt: "2026-11-01T00:00:00Z",
  lastOrderAt: "2026-11-01T00:00:00Z",
});

describe("filterCustomers", () => {
  const list = [c("Kim Muster", "kim@example.org"), c("Ali Weber", "ali@weber.de")];
  it("findet Name, E-Mail und mehrere Wörter", () => {
    expect(filterCustomers(list, "KIM").map((x) => x.name)).toEqual(["Kim Muster"]);
    expect(filterCustomers(list, "weber.de").map((x) => x.name)).toEqual(["Ali Weber"]);
    expect(filterCustomers(list, "ali weber").map((x) => x.name)).toEqual(["Ali Weber"]);
    expect(filterCustomers(list, "kim weber")).toEqual([]);
    expect(filterCustomers(list, "  ")).toHaveLength(2);
  });
});
