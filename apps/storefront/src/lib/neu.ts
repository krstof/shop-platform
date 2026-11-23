// „Neu“-Marke: Produkte, die seit höchstens 14 Tagen im Shop sind. Seit Paket P5 kann der Händler
// das je Produkt überstimmen: „immer“ zeigt das Schildchen dauerhaft, „nie“ gar nicht.

export const NEU_TAGE = 14;

/** Schalter am Produkt: automatisch nach Datum, immer oder nie. */
export type NeuSchalter = "auto" | "always" | "never";

export function istNeu(
  publishedAt: string | null | undefined,
  jetzt: Date = new Date(),
  schalter: NeuSchalter = "auto",
): boolean {
  if (schalter === "always") return true;
  if (schalter === "never") return false;
  if (publishedAt === null || publishedAt === undefined) return false;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  const alter = jetzt.getTime() - t;
  return alter >= 0 && alter <= NEU_TAGE * 24 * 3600_000;
}

/** Filter „nur verfügbare“ aus der Adresse (`?verfuegbar=ja`). */
export function nurVerfuegbar(roh: string | null | undefined): boolean {
  return roh === "ja";
}
