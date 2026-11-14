import { describe, expect, it } from "vitest";
import { filterCustomers, mergeCustomers, type CustomerSummary } from "./customers.js";

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

describe("Kundenliste mit Kundenkarten", () => {
  it("führt Bestellende und angelegte Karten über die E-Mail zusammen", () => {
    const rows = mergeCustomers(
      [
        {
          email: "Kim@example.org",
          name: "Kim Muster",
          orderCount: 2,
          revenue: 1000,
          firstOrderAt: "2026-11-01T10:00:00Z",
          lastOrderAt: "2026-11-10T10:00:00Z",
        },
      ],
      [
        {
          id: "1",
          email: "kim@example.org",
          firstName: "Kim",
          lastName: "M.",
          phone: "1",
          address: null,
          createdAt: "2026-11-02T00:00:00Z",
        },
        {
          id: "2",
          email: "neu@example.org",
          firstName: "Neu",
          lastName: "Kunde",
          phone: "",
          address: null,
          createdAt: "2026-11-14T00:00:00Z",
        },
      ],
    );
    expect(rows.map((r) => [r.email, r.orderCount, r.profile?.id ?? null])).toEqual([
      ["neu@example.org", 0, "2"],
      ["Kim@example.org", 2, "1"],
    ]);
    expect(rows[0]?.name).toBe("Neu Kunde");
  });
});
