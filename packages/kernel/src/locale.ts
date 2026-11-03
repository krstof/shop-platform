// Sprache der Fehlertexte (Entscheidung Kristof 30.10.2026): Deutsch und Englisch ab Welle 1,
// Auswahl über die Kopfzeile `Accept-Language`, Deutsch als Standard. Bewusst schlank:
// eine Texttabelle je Fehlercode in problem-texts.ts, keine Übersetzungsbibliothek.

export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";

const MAX_HEADER_LENGTH = 256;
const MAX_ENTRIES = 16;

/**
 * Wählt die Sprache aus `Accept-Language` (RFC 9110, 12.5.4): die unterstützte Sprache mit dem
 * höchsten q-Wert, bei Gleichstand die zuerst genannte. Unbekanntes oder Kaputtes ergibt Deutsch.
 * Überlange Kopfzeilen werden gar nicht erst zerlegt (Schutz vor teurer Verarbeitung).
 */
export function pickLocale(acceptLanguage: string | readonly string[] | undefined): Locale {
  const header = Array.isArray(acceptLanguage) ? acceptLanguage.join(",") : acceptLanguage;
  if (typeof header !== "string" || header === "" || header.length > MAX_HEADER_LENGTH) return DEFAULT_LOCALE;
  let best: Locale | undefined;
  let bestQ = 0;
  for (const part of header.split(",").slice(0, MAX_ENTRIES)) {
    const [rawTag = "", ...params] = part.trim().split(";");
    const primary = rawTag.trim().toLowerCase().split("-")[0] ?? "";
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*(0(\.\d{0,3})?|1(\.0{0,3})?)\s*$/i.exec(p);
      if (m?.[1] !== undefined) q = Number(m[1]);
    }
    if (q <= 0) continue;
    const locale = (LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : undefined;
    if (locale !== undefined && q > bestQ) {
      best = locale;
      bestQ = q;
    }
  }
  return best ?? DEFAULT_LOCALE;
}
