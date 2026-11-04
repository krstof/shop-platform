// Preisangaben nach Preisangabenverordnung (Anforderungen STR-02, STR-03): Endpreis inkl. MwSt.,
// Hinweis auf Versandkosten und Grundpreis je 100 g (bei Füllmengen bis 250 g ist 100 g erlaubt,
// wir nutzen für Tee einheitlich 100 g, damit Kunden vergleichen können).
import { formatMoney, formatRate, multiplyRatio, type CurrencyInfo, type Money } from "@shop/kernel";

const EUR_INFO: CurrencyInfo = { code: "EUR", minorUnits: 2, roundingMode: "half_up" };

export function preisText(preis: Money): string {
  return formatMoney(preis, EUR_INFO);
}

/** Grundpreis je 100 g, kaufmännisch gerundet, zum Beispiel „19,33 € / 100 g“. */
export function grundpreisText(preis: Money, gramm: number): string {
  if (!Number.isSafeInteger(gramm) || gramm <= 0) throw new RangeError("Füllmenge muss positiv sein");
  return `${formatMoney(multiplyRatio(preis, 100, gramm, "half_up"), EUR_INFO)} / 100 g`;
}

export function steuerText(steuerBp: number): string {
  return `inkl. ${formatRate(steuerBp)} MwSt., zzgl. Versand`;
}

export function mengeText(gramm: number): string {
  return `${new Intl.NumberFormat("de-DE").format(gramm)} g`;
}
