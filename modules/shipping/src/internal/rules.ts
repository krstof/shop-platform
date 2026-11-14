// Versandkosten (einfachste Form): eine Versandart „Standardversand“ mit Pauschale, wahlweise
// versandkostenfrei ab einem Bestellwert. Reine Rechenregeln ohne Datenbank.

export interface StandardShipping {
  /** Pauschale brutto in Cent; 0 = immer kostenlos. */
  readonly amount: number;
  /** Ab diesem Warenwert (brutto, Cent) kostenlos; `null` = keine Grenze. */
  readonly freeFrom: number | null;
}

/** Ohne Einstellung: kostenloser Versand (so verhielt sich der Shop bisher). */
export const FREE_SHIPPING: StandardShipping = { amount: 0, freeFrom: null };

export interface ShippingQuote {
  readonly name: string;
  readonly amount: number;
}

/** Versandkosten für einen Warenwert. Leerer Warenkorb kostet nichts. */
export function quoteFor(subtotal: number, s: StandardShipping): ShippingQuote {
  const free = subtotal <= 0 || s.amount === 0 || (s.freeFrom !== null && subtotal >= s.freeFrom);
  return free
    ? { name: "Standardversand (kostenlos)", amount: 0 }
    : { name: "Standardversand", amount: s.amount };
}
