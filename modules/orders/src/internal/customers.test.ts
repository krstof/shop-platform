import { describe, expect, it } from "vitest";
import { summarizeCustomers } from "./customers.js";

const row = (
  email: string,
  day: number,
  total: number,
  extra: Partial<{ status: string; paymentStatus: string; first: string }> = {},
) => ({
  email,
  firstName: extra.first ?? "Kim",
  lastName: "Muster",
  total,
  status: extra.status ?? "open",
  paymentStatus: extra.paymentStatus ?? "paid",
  placedAt: new Date(Date.UTC(2026, 10, day)),
});

describe("summarizeCustomers", () => {
  it("fasst je E-Mail zusammen, Groß-/Kleinschreibung egal, neueste zuerst", () => {
    const r = summarizeCustomers([
      row("kim@example.org", 1, 1000),
      row("KIM@example.org", 5, 2000, { first: "Kimberly" }),
      row("ali@example.org", 3, 500, { paymentStatus: "unpaid", status: "pending_payment" }),
      row("kim@example.org", 4, 900, { status: "cancelled", paymentStatus: "refunded" }),
    ]);
    expect(r.map((c) => c.email)).toEqual(["KIM@example.org", "ali@example.org"]);
    expect(r[0]).toMatchObject({ name: "Kimberly Muster", orderCount: 2, revenue: 3000 });
    expect(r[0]?.firstOrderAt.getUTCDate()).toBe(1);
    expect(r[1]).toMatchObject({ orderCount: 1, revenue: 0 });
  });
  it("leer bleibt leer", () => {
    expect(summarizeCustomers([])).toEqual([]);
  });
});
