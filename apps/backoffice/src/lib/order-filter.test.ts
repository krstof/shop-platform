import { describe, expect, it } from "vitest";
import { isOrderFiltered, orderListPath, parseOrderFilter } from "./order-filter.js";

describe("Filter der Bestellliste", () => {
  it("liest gültige Werte aus der Adresse", () => {
    expect(parseOrderFilter({ suche: "  Kim ", stand: "versenden" })).toEqual({
      suche: "Kim",
      stand: "versenden",
    });
  });

  it("nimmt eine Bestellnummer auch als Zahl an", () => {
    expect(parseOrderFilter({ suche: 10003 })).toEqual({ suche: "10003" });
  });

  it("ignoriert leere, kaputte und unbekannte Werte", () => {
    expect(parseOrderFilter({ suche: "   ", stand: "alle", foo: 1 })).toEqual({});
    expect(parseOrderFilter({ suche: null, stand: "open" })).toEqual({});
    expect(parseOrderFilter({ suche: "a\u0000b" })).toEqual({ suche: "a b" });
    expect(parseOrderFilter({ suche: "x".repeat(150) }).suche).toHaveLength(100);
  });

  it("baut die Adresse der API", () => {
    expect(orderListPath({})).toBe("/admin/v1/orders");
    expect(orderListPath({ stand: "zahlung" })).toBe("/admin/v1/orders?status=pending_payment");
    expect(orderListPath({ stand: "versendet", suche: "Kim & Co" })).toBe(
      "/admin/v1/orders?q=Kim+%26+Co&status=completed",
    );
  });

  it("erkennt, ob gefiltert wird", () => {
    expect(isOrderFiltered({})).toBe(false);
    expect(isOrderFiltered({ stand: "versenden" })).toBe(true);
  });
});
