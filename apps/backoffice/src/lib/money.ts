// Preise im Backoffice: Eingabe wie „8,90“ oder „8.90 €“, gespeichert als ganze Cent (ADR-006).

/** Cent als deutscher Betrag, etwa 890 → „8,90 €“. */
export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Cent als Eingabetext ohne Währung, etwa 890 → „8,90“. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Liest einen Betrag in Euro und gibt Cent zurück; `undefined`, wenn es kein gültiger Betrag ist.
 * Erlaubt „8,90“, „8.90“, „8“, „1.234,50“, „1234,5“ und ein €-Zeichen. Höchstens zwei Nachkommastellen.
 */
export function parseEuro(text: string): number | undefined {
  let t = text.replace(/€|\s/g, "");
  if (t === "") return undefined;
  // Tausenderpunkte („1.234,50“) entfernen, wenn ein Komma folgt.
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "");
  t = t.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const [euros = "0", cents = ""] = t.split(".");
  const value = Number(euros) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : undefined;
}
