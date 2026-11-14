import { describe, expect, it } from "vitest";
import { csvCell, isOrderFiltered, orderListPath, ordersCsv, parseOrderFilter } from "./order-filter.js";

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

  it("kennt den Stand „storniert“", () => {
    expect(parseOrderFilter({ stand: "storniert" })).toEqual({ stand: "storniert" });
    expect(orderListPath({ stand: "storniert" })).toBe("/admin/v1/orders?status=cancelled");
    expect(parseOrderFilter({ stand: "toString" })).toEqual({});
  });

  it("schreibt CSV mit Semikolon, Anführungszeichen und entschärften Formeln", () => {
    expect(csvCell("Kim Muster")).toBe("Kim Muster");
    expect(csvCell('Kim "K"; Muster')).toBe('"Kim ""K""; Muster"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5")).toBe("'-5");
    const csv = ordersCsv(
      [
        {
          orderNumber: "10001",
          placedAt: "2026-11-14T10:00:00Z",
          customerName: "Kim Muster",
          email: "kim@example.org",
          itemCount: 2,
          total: 2270,
          status: "open",
          paymentStatus: "paid",
        },
      ],
      () => "Bezahlt",
    );
    expect(csv.startsWith("\uFEFFBestellnummer;Datum;")).toBe(true);
    expect(csv).toContain("10001;14.11.26, 11:00;Kim Muster;kim@example.org;2;22,70;Bezahlt\r\n");
  });
});
