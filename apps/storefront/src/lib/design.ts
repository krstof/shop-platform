// Aussehen eines Shops (Shop-Editor Teil 1): Hauptfarbe und Schrift als CSS-Variablen.
// Die Werte kommen aus der Storefront-API, werden hier aber trotzdem streng geprüft, bevor sie in
// CSS landen. Ausgeliefert als eigene Datei /<shop>/design.css, weil die Sicherheitsregeln (CSP)
// keine Stile direkt in der Seite erlauben.

export type Font = "klassisch" | "modern" | "freundlich";

export interface StoreImageRef {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** Inhalt der Startseite (Shop-Editor Teil 2): großes Bild, Überschrift, Text, Empfehlungen, Kategorien. */
export interface StoreHome {
  readonly heroImage: StoreImageRef | null;
  readonly heroTitle: string;
  readonly heroText: string;
  readonly featuredProductIds: readonly string[];
  readonly showCategories: boolean;
  /** „Neu im Shop“ zeigen; ältere API-Stände ohne (dann ja). */
  readonly showNew?: boolean;
}

/** Kopf- und Fußzeile (Shop-Editor Teil 3). */
export interface StoreFooter {
  readonly text: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
}

export interface StoreDesign {
  readonly accentColor: string;
  readonly accentDarkColor: string;
  readonly font: Font;
  readonly logo: StoreImageRef | null;
  readonly home: StoreHome;
  readonly tagline: string;
  readonly footer: StoreFooter;
}

/** Nur sichere Linkziele ausgeben (https/http, mailto, tel), auch wenn die API schon prüft. */
export function safeLink(url: string): string | undefined {
  const ok = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()/-]+)$/i.test(url) && url.length <= 300;
  return ok ? url : undefined;
}

/** Externe Webseite? Dann in neuem Tab mit rel="noopener noreferrer". */
export function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
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

export const DEFAULT_HOME: StoreHome = {
  heroImage: null,
  heroTitle: "",
  heroText: "",
  featuredProductIds: [],
  showCategories: true,
  showNew: true,
};

export const DEFAULT_DESIGN: StoreDesign = {
  accentColor: "#3f6b4a",
  accentDarkColor: "#2f5038",
  font: "klassisch",
  logo: null,
  home: DEFAULT_HOME,
  tagline: "",
  footer: { text: "", links: [] },
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
