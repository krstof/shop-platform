// Stand einer Bestellung in Kundensprache (Bestellstatus-Seite).

export interface Schritt {
  readonly text: string;
  readonly erledigt: boolean;
}

export interface Bestellstand {
  /** Kurzer Satz oben auf der Seite. */
  readonly satz: string;
  /** Bestellt → Bezahlt → Versendet; bei Stornierung leer. */
  readonly schritte: readonly Schritt[];
  readonly storniert: boolean;
}

export function bestellstand(o: { status: string; paymentStatus: string }): Bestellstand {
  if (o.status === "cancelled")
    return {
      satz:
        o.paymentStatus === "refunded"
          ? "Diese Bestellung wurde storniert. Das Geld geht zurück (im Testshop wurde nichts berechnet)."
          : "Diese Bestellung wurde storniert.",
      schritte: [],
      storniert: true,
    };
  const bezahlt = o.paymentStatus === "paid" || o.status === "open" || o.status === "completed";
  const versendet = o.status === "completed";
  return {
    satz: versendet
      ? "Deine Bestellung ist unterwegs."
      : bezahlt
        ? "Bezahlt. Der Shop packt deine Bestellung."
        : "Die Zahlung fehlt noch.",
    schritte: [
      { text: "Bestellt", erledigt: true },
      { text: "Bezahlt", erledigt: bezahlt },
      { text: "Versendet", erledigt: versendet },
    ],
    storniert: false,
  };
}
