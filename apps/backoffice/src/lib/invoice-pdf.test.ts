import { describe, expect, it } from "vitest";
import { fitText, invoicePdf, winAnsi, type InvoiceOrder } from "./invoice-pdf.js";

const ORDER: InvoiceOrder = {
  orderNumber: "1001",
  placedAt: "2026-11-14T10:00:00Z",
  email: "kim@example.org",
  paymentStatus: "paid",
  paymentMethodName: "Testzahlung",
  address: {
    firstName: "Kim",
    lastName: "Müller",
    street: "Teeweg 1",
    postalCode: "20095",
    city: "Hamburg",
    countryCode: "DE",
  },
  subtotal: 2390,
  discount: 200,
  couponCode: "HALLO",
  shipping: 0,
  total: 2190,
  taxByRate: { "7": 143 },
  lines: [
    {
      position: 1,
      name: "Grüner Tee (Sencha)",
      sku: "T-1",
      quantity: 2,
      unitPrice: 995,
      lineTotal: 1990,
      taxRatePercent: 7,
    },
    {
      position: 2,
      name: "Teesieb",
      sku: null,
      quantity: 1,
      unitPrice: 400,
      lineTotal: 400,
      taxRatePercent: 7,
    },
  ],
};

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

describe("Rechnung als PDF", () => {
  it("baut eine gültige PDF-Datei mit stimmenden Verweisen", () => {
    const s = latin1(invoicePdf(ORDER, { shopName: "Teeladen", vatId: "DE123456789" }));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    // Jeder Eintrag der Tabelle zeigt auf den Anfang seines Objekts.
    const entries = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(s).toContain("(Rechnung)");
    expect(s).toContain("M\xfcller"); // Umlaut als WinAnsi
    expect(s).toContain("Gr\xfcner Tee \\(Sencha\\)"); // Klammern maskiert
    expect(s).toContain("USt-IdNr. DE123456789");
    expect(s).toContain("/Count 1");
  });

  it("verteilt viele Artikel auf mehrere Seiten", () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      ...(ORDER.lines[1] ?? ORDER.lines[0]),
      position: i + 1,
    }));
    const s = latin1(invoicePdf({ ...ORDER, lines }, { shopName: "Teeladen" }));
    expect(Number(/\/Count (\d+)/.exec(s)?.[1])).toBeGreaterThan(1);
    expect(s).toContain("Seite 1 von");
  });

  it("kodiert Euro und kürzt lange Namen", () => {
    expect(winAnsi("€ä–☕")).toEqual([0x80, 0xe4, 0x96, 63]);
    const t = fitText("Ein sehr langer Produktname ".repeat(10), 100, 10);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThan(40);
  });
});
