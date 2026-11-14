import { describe, expect, it } from "vitest";
import { bestellstand } from "./bestellstand.js";

const done = (s: ReturnType<typeof bestellstand>) => s.schritte.filter((x) => x.erledigt).map((x) => x.text);

describe("bestellstand", () => {
  it("unbezahlt, bezahlt, versendet", () => {
    expect(done(bestellstand({ status: "pending_payment", paymentStatus: "unpaid" }))).toEqual(["Bestellt"]);
    expect(done(bestellstand({ status: "open", paymentStatus: "paid" }))).toEqual(["Bestellt", "Bezahlt"]);
    const v = bestellstand({ status: "completed", paymentStatus: "paid" });
    expect(done(v)).toEqual(["Bestellt", "Bezahlt", "Versendet"]);
    expect(v.satz).toContain("unterwegs");
  });
  it("storniert, mit und ohne Erstattung", () => {
    const s = bestellstand({ status: "cancelled", paymentStatus: "refunded" });
    expect(s.storniert).toBe(true);
    expect(s.schritte).toEqual([]);
    expect(s.satz).toContain("Geld geht zurück");
    expect(bestellstand({ status: "cancelled", paymentStatus: "unpaid" }).satz).toBe(
      "Diese Bestellung wurde storniert.",
    );
  });
});
