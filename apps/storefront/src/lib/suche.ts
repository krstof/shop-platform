// Suche in der Storefront: Suchfeld im Kopf jeder Seite, Treffer auf /<shop>/suche?q=…

/** Höchstlänge wie in der Storefront-API (`q`, 1 bis 100 Zeichen). */
export const SUCHE_MAX = 100;

/** Steuerzeichen sowie Zeilen- und Absatztrenner. */
const STEUERZEICHEN = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * Bereinigt den Suchtext aus der Adresse: Steuerzeichen raus, Leerraum zusammengefasst, auf
 * 100 Zeichen gekürzt. `undefined`, wenn nichts übrig bleibt (dann wird nicht gesucht).
 */
export function suchbegriff(roh: string | null | undefined): string | undefined {
  if (roh === null || roh === undefined) return undefined;
  const text = roh.replace(STEUERZEICHEN, " ").replace(/\s+/g, " ").trim().slice(0, SUCHE_MAX).trim();
  return text === "" ? undefined : text;
}

/** „1 Treffer“, „3 Treffer“, „Keine Treffer“. */
export function trefferText(anzahl: number): string {
  return anzahl === 0 ? "Keine Treffer" : `${anzahl} Treffer`;
}
