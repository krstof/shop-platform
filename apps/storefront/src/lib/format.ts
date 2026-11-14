// Anzeige von Preisen und Texten in der Storefront.

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Cent als Euro, etwa 890 → „8,90 €“ (mit festem Leerzeichen). */
export function euro(cents: number): string {
  return EUR.format(cents / 100);
}

/** Versandkosten des Shops (Storefront-API /shipping). */
export interface Versand {
  readonly amount: number;
  readonly freeFrom: number | null;
}

export const VERSAND_KOSTENLOS: Versand = { amount: 0, freeFrom: null };

/** „versandkostenfrei“ oder „zzgl. 4,90 € Versand (ab 50,00 € versandkostenfrei)“. */
export function versandText(v: Versand): string {
  if (v.amount === 0) return "versandkostenfrei";
  const grenze = v.freeFrom === null ? "" : ` (ab ${euro(v.freeFrom)} versandkostenfrei)`;
  return `zzgl. ${euro(v.amount)} Versand${grenze}`;
}

/** Pflichtangabe neben dem Preis (Preisangabenverordnung). */
export function steuerHinweis(prozent: number, versand: Versand = VERSAND_KOSTENLOS): string {
  return `inkl. ${prozent} % MwSt., ${versandText(versand)}`;
}

/** Wie viel fehlt noch bis zum kostenlosen Versand? `undefined`, wenn das nicht passt. */
export function fehltBisKostenlos(zwischensumme: number, v: Versand): number | undefined {
  if (v.amount === 0 || v.freeFrom === null || zwischensumme <= 0 || zwischensumme >= v.freeFrom)
    return undefined;
  return v.freeFrom - zwischensumme;
}

/** Absätze aus Klartext (getrennt durch Leerzeilen). Ausgabe immer als Text, nie als HTML. */
export function absaetze(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** „Sofort lieferbar.“ oder „Lieferzeit 2–3 Werktage.“ */
export function lieferzeit(d: { min: number; max: number } | null | undefined): string {
  if (d === null || d === undefined) return "Sofort lieferbar.";
  if (d.min === d.max) return `Lieferzeit ${d.min} ${d.min === 1 ? "Werktag" : "Werktage"}.`;
  return `Lieferzeit ${d.min}–${d.max} Werktage.`;
}
