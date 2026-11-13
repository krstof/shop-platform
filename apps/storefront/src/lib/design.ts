// Aussehen eines Shops (Shop-Editor Teil 1): Hauptfarbe und Schrift als CSS-Variablen.
// Die Werte kommen aus der Storefront-API, werden hier aber trotzdem streng geprüft, bevor sie in
// CSS landen. Ausgeliefert als eigene Datei /<shop>/design.css, weil die Sicherheitsregeln (CSP)
// keine Stile direkt in der Seite erlauben.

export type Font = "klassisch" | "modern" | "freundlich";

export interface StoreDesign {
  readonly accentColor: string;
  readonly accentDarkColor: string;
  readonly font: Font;
  readonly logo: { readonly url: string; readonly width: number; readonly height: number } | null;
}

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const ROUNDED =
  'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, ' +
  '"Arial Rounded MT", "Arial Rounded MT Bold", Calibri, source-sans-pro, sans-serif';

/** Schriften je Auswahl: Überschriften (titel) und Fließtext (text). Gleiche Tabelle im Backoffice. */
export const FONT_STACKS: Readonly<Record<Font, { titel: string; text: string }>> = {
  klassisch: { titel: SERIF, text: SYSTEM },
  modern: { titel: SYSTEM, text: SYSTEM },
  freundlich: { titel: ROUNDED, text: ROUNDED },
};

export const DEFAULT_DESIGN: StoreDesign = {
  accentColor: "#3f6b4a",
  accentDarkColor: "#2f5038",
  font: "klassisch",
  logo: null,
};

const HEX = /^#[0-9a-f]{6}$/;

function safeColor(value: string, fallback: string): string {
  const v = value.toLowerCase();
  return HEX.test(v) ? v : fallback;
}

/** CSS mit den Variablen des Shops. `:root:root` gewinnt sicher gegen die Standardwerte in shop.css. */
export function designCss(design: StoreDesign): string {
  const fonts = FONT_STACKS[design.font] ?? FONT_STACKS.klassisch;
  return [
    ":root:root {",
    `  --akzent: ${safeColor(design.accentColor, DEFAULT_DESIGN.accentColor)};`,
    `  --akzent-dunkel: ${safeColor(design.accentDarkColor, DEFAULT_DESIGN.accentDarkColor)};`,
    `  --schrift-titel: ${fonts.titel};`,
    `  --schrift-text: ${fonts.text};`,
    "}",
    "",
  ].join("\n");
}

/** Kurzer Fingerabdruck für die Adresse der CSS-Datei, damit der Browser Änderungen sofort holt. */
export function designVersion(design: StoreDesign): string {
  const s = `${design.accentColor}|${design.accentDarkColor}|${design.font}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
