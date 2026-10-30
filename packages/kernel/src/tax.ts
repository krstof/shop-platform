// Steuersätze in Basispunkten (Datenmodell 2.11, Q-08): 1900 = 19 %, 700 = 7 %.
// Hier stehen nur die Rechenbausteine. Welcher Satz gilt, entscheidet das Modul `tax` (E8).
import { z } from "zod";
import { money, subtract, type Money } from "./money.js";
import { divRound, type RoundingMode } from "./rounding.js";

/** Wie die Domain `kernel.rate_bp`: ganze Zahl zwischen 0 und 100000 (0 % bis 1000 %). */
export const rateBpSchema = z.number().int().min(0).max(100_000);
export type RateBp = number;

const BP_PER_WHOLE = 10_000n;

function checkRate(rateBp: number): bigint {
  rateBpSchema.parse(rateBp);
  return BigInt(rateBp);
}

/**
 * Steueranteil in einem Bruttobetrag: brutto × Satz / (10000 + Satz), gerundet.
 * Beispiel: 19,99 € bei 19 % → 3,19 € Steuer.
 */
export function taxFromGross(gross: Money, rateBp: number, mode: RoundingMode = "half_up"): Money {
  const r = checkRate(rateBp);
  return money(divRound(BigInt(gross.amount) * r, BP_PER_WHOLE + r, mode), gross.currency);
}

/** Nettobetrag aus Brutto: Brutto minus gerundeter Steueranteil, damit Netto + Steuer = Brutto exakt gilt. */
export function netFromGross(gross: Money, rateBp: number, mode: RoundingMode = "half_up"): Money {
  return subtract(gross, taxFromGross(gross, rateBp, mode));
}

/** Steuer auf einen Nettobetrag: netto × Satz / 10000, gerundet (für B2B ab Welle 3). */
export function taxFromNet(net: Money, rateBp: number, mode: RoundingMode = "half_up"): Money {
  const r = checkRate(rateBp);
  return money(divRound(BigInt(net.amount) * r, BP_PER_WHOLE, mode), net.currency);
}

/** Bruttobetrag aus Netto: Netto plus gerundete Steuer. */
export function grossFromNet(net: Money, rateBp: number, mode: RoundingMode = "half_up"): Money {
  const tax = taxFromNet(net, rateBp, mode);
  return money(BigInt(net.amount) + BigInt(tax.amount), net.currency);
}

/** Basispunkte als Prozenttext für die Anzeige, zum Beispiel 1900 → „19 %“, 550 → „5,5 %“. */
export function formatRate(rateBp: number, locale = "de-DE"): string {
  checkRate(rateBp);
  const whole = Math.trunc(rateBp / 100);
  const frac = (rateBp % 100).toString().padStart(2, "0").replace(/0+$/, "");
  const decimal = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return `${fmt.format(decimal as Intl.StringNumericLiteral)} %`;
}
