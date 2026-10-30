// Exakte ganzzahlige Division mit ausdrücklicher Rundungsregel (ADR-006).
// Es wird nie mit Kommazahlen gerechnet: Zwischenergebnisse sind bigint.

/** Rundungsregeln aus `kernel.currency.rounding_mode`. */
export const ROUNDING_MODES = ["half_up", "half_even"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/**
 * Teilt `numerator` durch `denominator` und rundet auf eine ganze Zahl.
 *
 * - `half_up`: kaufmännisch, also ab der Hälfte weg von null (2,5 → 3, −2,5 → −3).
 * - `half_even`: bei genau der Hälfte zur geraden Zahl (2,5 → 2, 3,5 → 4).
 */
export function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new RangeError("Division durch null");
  // Vorzeichen getrennt behandeln, damit beide Regeln symmetrisch um null sind.
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d) q += 1n;
  else if (twice === d) {
    if (mode === "half_up" || q % 2n === 1n) q += 1n;
  }
  return negative ? -q : q;
}
