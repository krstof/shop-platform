// Anzeige von Preisen und Texten in der Storefront.

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Cent als Euro, etwa 890 → „8,90 €“ (mit festem Leerzeichen). */
export function euro(cents: number): string {
  return EUR.format(cents / 100);
}

/** Pflichtangabe neben dem Preis (Preisangabenverordnung). */
export function steuerHinweis(prozent: number): string {
  return `inkl. ${prozent} % MwSt., versandkostenfrei`;
}

/** Absätze aus Klartext (getrennt durch Leerzeilen). Ausgabe immer als Text, nie als HTML. */
export function absaetze(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
