import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  compare,
  CurrencyMismatchError,
  equals,
  formatMoney,
  isNegative,
  isZero,
  money,
  moneySchema,
  multiply,
  multiplyRatio,
  negate,
  subtract,
  sum,
  toDecimalString,
  zero,
  type CurrencyInfo,
} from "./money.js";
import { divRound } from "./rounding.js";

const EUR: CurrencyInfo = { code: "EUR", minorUnits: 2, roundingMode: "half_up" };
const JPY: CurrencyInfo = { code: "JPY", minorUnits: 0, roundingMode: "half_up" };
const eur = (n: number) => money(n, "EUR");

describe("divRound", () => {
  it.each([
    [5n, 2n, "half_up", 3n],
    [-5n, 2n, "half_up", -3n],
    [5n, 2n, "half_even", 2n],
    [7n, 2n, "half_even", 4n],
    [-5n, 2n, "half_even", -2n],
    [10n, 3n, "half_up", 3n],
    [11n, 3n, "half_up", 4n],
    [-11n, 3n, "half_up", -4n],
    [4n, -2n, "half_up", -2n],
    [0n, 7n, "half_up", 0n],
  ] as const)("%s / %s (%s) = %s", (n, d, mode, expected) => {
    expect(divRound(n, d, mode)).toBe(expected);
  });

  it("verweigert Division durch null", () => {
    expect(() => divRound(1n, 0n, "half_up")).toThrow(RangeError);
  });
});

describe("money", () => {
  it("speichert ganze Zahlen in Cent mit Währung", () => {
    expect(eur(1999)).toEqual({ amount: 1999, currency: "EUR" });
  });

  it("lehnt Kommazahlen, unsichere Zahlen und falsche Codes ab", () => {
    expect(() => money(19.99, "EUR")).toThrow(RangeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "EUR")).toThrow(RangeError);
    expect(() => money(Number.NaN, "EUR")).toThrow(RangeError);
    expect(() => money(1, "eur")).toThrow();
    expect(() => money(1, "EURO")).toThrow();
  });

  it("ist unveränderlich und kennt kein -0", () => {
    const m = eur(5);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.is(money(-0, "EUR").amount, 0)).toBe(true);
    expect(Object.is(negate(zero("EUR")).amount, 0)).toBe(true);
  });

  it("rechnet exakt, wo Kommazahlen scheitern (0,1 + 0,2)", () => {
    expect(add(eur(10), eur(20))).toEqual(eur(30));
    expect(sum([eur(1999), eur(1), eur(-500)])).toEqual(eur(1500));
    expect(subtract(eur(100), eur(250))).toEqual(eur(-150));
    expect(multiply(eur(1999), 3)).toEqual(eur(5997));
  });

  it("verrechnet nie verschiedene Währungen", () => {
    expect(() => add(eur(1), money(1, "USD"))).toThrow(CurrencyMismatchError);
    expect(() => sum([eur(1), money(1, "USD")])).toThrow(CurrencyMismatchError);
    expect(() => compare(eur(1), money(1, "USD"))).toThrow(CurrencyMismatchError);
    expect(equals(eur(1), money(1, "USD"))).toBe(false);
  });

  it("braucht bei leerer Summe eine Währung", () => {
    expect(sum([], "EUR")).toEqual(eur(0));
    expect(() => sum([])).toThrow(RangeError);
  });

  it("erkennt Überlauf statt still zu runden", () => {
    expect(() => add(eur(Number.MAX_SAFE_INTEGER), eur(1))).toThrow(RangeError);
    expect(() => multiply(eur(1), 1.5)).toThrow(RangeError);
  });

  it("rundet bei Brüchen nur ausdrücklich", () => {
    // 15 % Rabatt auf 9,99 € = 1,4985 € → 1,50 €
    expect(multiplyRatio(eur(999), 15, 100, "half_up")).toEqual(eur(150));
    expect(multiplyRatio(eur(5), 1, 2, "half_even")).toEqual(eur(2));
  });

  it("vergleicht und prüft", () => {
    expect(compare(eur(1), eur(2))).toBe(-1);
    expect(compare(eur(2), eur(2))).toBe(0);
    expect(compare(eur(3), eur(2))).toBe(1);
    expect(isZero(eur(0))).toBe(true);
    expect(isNegative(eur(-1))).toBe(true);
  });
});

describe("allocate", () => {
  it("verteilt ohne Rundungsverlust", () => {
    const parts = allocate(eur(100), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(sum(parts)).toEqual(eur(100));
  });

  it("verteilt Versandkosten nach Warenanteil (19 % und 7 %)", () => {
    // Waren: 30,00 € zu 19 %, 10,00 € zu 7 %; Versand 4,95 €
    const parts = allocate(eur(495), [3000, 1000]);
    expect(parts.map((p) => p.amount)).toEqual([371, 124]);
    expect(sum(parts)).toEqual(eur(495));
  });

  it("funktioniert mit negativen Beträgen (Gutschrift)", () => {
    const parts = allocate(eur(-100), [1, 2]);
    expect(parts.map((p) => p.amount)).toEqual([-33, -67]);
    expect(sum(parts)).toEqual(eur(-100));
  });

  it("erhält die Summe auch bei vielen zufälligen Fällen", () => {
    for (let i = 1; i < 500; i++) {
      const weights = [i % 7, (i * 13) % 11, ((i * 31) % 5) + 1];
      expect(sum(allocate(eur(i * 37 - 5000), weights))).toEqual(eur(i * 37 - 5000));
    }
  });

  it("lehnt ungültige Gewichte ab", () => {
    expect(() => allocate(eur(1), [])).toThrow(RangeError);
    expect(() => allocate(eur(1), [0, 0])).toThrow(RangeError);
    expect(() => allocate(eur(1), [-1, 2])).toThrow(RangeError);
    expect(() => allocate(eur(1), [0.5])).toThrow(RangeError);
  });
});

describe("Anzeige", () => {
  it("wandelt exakt in Dezimaltext", () => {
    expect(toDecimalString(eur(1999), 2)).toBe("19.99");
    expect(toDecimalString(eur(5), 2)).toBe("0.05");
    expect(toDecimalString(eur(-5), 2)).toBe("-0.05");
    expect(toDecimalString(money(1234, "JPY"), 0)).toBe("1234");
    expect(toDecimalString(eur(Number.MAX_SAFE_INTEGER), 2)).toBe("90071992547409.91");
  });

  it("formatiert für Deutschland", () => {
    expect(formatMoney(eur(1999), EUR).replace(/\s/g, " ")).toBe("19,99 €");
    expect(formatMoney(eur(123456789), EUR).replace(/\s/g, " ")).toBe("1.234.567,89 €");
    expect(formatMoney(money(1234, "JPY"), JPY).replace(/\s/g, " ")).toBe("1.234 ¥");
    expect(() => formatMoney(eur(1), JPY)).toThrow(CurrencyMismatchError);
  });
});

describe("moneySchema", () => {
  it("prüft die API-Form streng", () => {
    expect(moneySchema.parse({ amount: 1999, currency: "EUR" })).toEqual(eur(1999));
    expect(moneySchema.safeParse({ amount: 19.99, currency: "EUR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: "1999", currency: "EUR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: 1, currency: "EUR", extra: 1 }).success).toBe(false);
  });
});
