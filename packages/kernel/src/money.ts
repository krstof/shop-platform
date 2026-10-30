// Geld-Typ (ADR-006, Q-08): ganze Zahl in der kleinsten Einheit plus ISO-4217-Code.
// Rechnet nur mit gleicher Währung und rundet nur auf ausdrücklichen Wunsch.
import { z } from "zod";
import { divRound, type RoundingMode } from "./rounding.js";

/** Drei Großbuchstaben nach ISO 4217, wie die Domain `kernel.currency_code`. */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Währungscode aus drei Großbuchstaben (ISO 4217) erwartet");
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/**
 * Ein Betrag ist eine sichere ganze Zahl (|x| ≤ 2^53 − 1). Das reicht für
 * rund 90 Billionen Euro und passt verlustfrei in JSON und in `bigint` der Datenbank.
 */
export const amountSchema = z.number().int().safe();

/** API-Form: `{ "amount": 1999, "currency": "EUR" }` für 19,99 Euro. */
export const moneySchema = z.strictObject({
  amount: amountSchema,
  currency: currencyCodeSchema,
});

export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/** Angaben zu einer Währung aus der Tabelle `kernel.currency` (nicht im Code fest verdrahtet). */
export interface CurrencyInfo {
  readonly code: CurrencyCode;
  /** Nachkommastellen, zum Beispiel 2 für Euro, 0 für Yen. */
  readonly minorUnits: number;
  readonly roundingMode: RoundingMode;
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Beträge in verschiedenen Währungen (${a} und ${b}) können nicht verrechnet werden`);
    this.name = "CurrencyMismatchError";
  }
}

function checkAmount(value: number | bigint): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || (typeof value === "bigint" && BigInt(n) !== value)) {
    throw new RangeError("Betrag ist keine sichere ganze Zahl");
  }
  // -0 vermeiden, damit Vergleiche und JSON eindeutig bleiben.
  return n === 0 ? 0 : n;
}

/** Legt einen Betrag an. Wirft bei Kommazahlen, zu großen Werten oder ungültigem Code. */
export function money(amount: number | bigint, currency: string): Money {
  return Object.freeze({
    amount: checkAmount(amount),
    currency: currencyCodeSchema.parse(currency),
  });
}

export function zero(currency: string): Money {
  return money(0, currency);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(BigInt(a.amount) + BigInt(b.amount), a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(BigInt(a.amount) - BigInt(b.amount), a.currency);
}

/** Summe einer Liste. Bei leerer Liste muss die Währung angegeben werden. */
export function sum(items: readonly Money[], currency?: string): Money {
  const first = items[0];
  const code = first?.currency ?? currency;
  if (code === undefined) throw new RangeError("Leere Summe braucht eine Währung");
  let total = 0n;
  for (const m of items) {
    if (m.currency !== code) throw new CurrencyMismatchError(code, m.currency);
    total += BigInt(m.amount);
  }
  return money(total, code);
}

/** Multipliziert mit einer ganzen Zahl, etwa der Menge einer Warenkorbposition. Keine Rundung nötig. */
export function multiply(a: Money, factor: number): Money {
  if (!Number.isSafeInteger(factor)) throw new RangeError("Faktor muss eine ganze Zahl sein");
  return money(BigInt(a.amount) * BigInt(factor), a.currency);
}

/**
 * Multipliziert mit einem Bruch `numerator / denominator` und rundet ausdrücklich.
 * Beispiel Rabatt 15 %: `multiplyRatio(price, 15, 100, "half_up")`.
 */
export function multiplyRatio(
  a: Money,
  numerator: number | bigint,
  denominator: number | bigint,
  mode: RoundingMode,
): Money {
  return money(divRound(BigInt(a.amount) * BigInt(numerator), BigInt(denominator), mode), a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amount, a.currency);
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function isNegative(a: Money): boolean {
  return a.amount < 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

/** −1, 0 oder 1. Wirft bei verschiedenen Währungen. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/**
 * Verteilt einen Betrag ohne Rundungsverlust nach Gewichten (Verfahren der größten Reste).
 * Die Teile ergeben immer exakt den Gesamtbetrag. Gebraucht etwa, um Versandkosten
 * nach dem Warenanteil auf Steuersätze aufzuteilen (STR-01).
 * Bei gleichen Resten bekommt das frühere Gewicht den Cent, damit das Ergebnis stabil ist.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError("Mindestens ein Gewicht nötig");
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw new RangeError("Gewichte müssen ganze Zahlen ≥ 0 sein");
    return BigInt(x);
  });
  const weightSum = w.reduce((s, x) => s + x, 0n);
  if (weightSum === 0n) throw new RangeError("Summe der Gewichte darf nicht null sein");

  const amount = BigInt(total.amount);
  const sign = amount < 0n ? -1n : 1n;
  const abs = amount * sign;
  const parts = w.map((x) => (abs * x) / weightSum);
  const remainders = w.map((x, i) => ({ i, r: (abs * x) % weightSum }));
  let rest = abs - parts.reduce((s, x) => s + x, 0n);
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of remainders) {
    if (rest === 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    rest -= 1n;
  }
  return parts.map((p) => money(p * sign, total.currency));
}

/**
 * Wandelt in eine exakte Dezimalzeichenkette ("19.99"), ohne Kommazahlen zu benutzen.
 * Grundlage für die Anzeige und für Formate wie die E-Rechnung.
 */
export function toDecimalString(a: Money, minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) {
    throw new RangeError("minorUnits muss zwischen 0 und 4 liegen");
  }
  const negative = a.amount < 0;
  const digits = Math.abs(a.amount)
    .toString()
    .padStart(minorUnits + 1, "0");
  const whole = digits.slice(0, digits.length - minorUnits);
  const frac = digits.slice(digits.length - minorUnits);
  return `${negative ? "-" : ""}${whole}${minorUnits > 0 ? `.${frac}` : ""}`;
}

/** Anzeige für Menschen, zum Beispiel „19,99 €“ für `de-DE`. */
export function formatMoney(a: Money, info: CurrencyInfo, locale = "de-DE"): string {
  if (info.code !== a.currency) throw new CurrencyMismatchError(a.currency, info.code);
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: a.currency,
    minimumFractionDigits: info.minorUnits,
    maximumFractionDigits: info.minorUnits,
  });
  // Intl.NumberFormat nimmt Dezimalzeichenketten exakt entgegen (keine Gleitkommazahl).
  return fmt.format(toDecimalString(a, info.minorUnits) as Intl.StringNumericLiteral);
}
