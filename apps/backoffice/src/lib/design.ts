// Shop-Editor Teil 1: fertige Farben, Schriften und die Kontrastprüfung für die Vorschau.
// Dieselben Regeln prüft die API (Modul storefront), die Schriften stehen auch in der Storefront
// (apps/storefront/src/lib/design.ts). Hier nur, damit der Editor sofort reagiert.

export type Font = "klassisch" | "modern" | "freundlich";

/** Grenzen der Startseite (Shop-Editor Teil 2), gleich wie in der API (Modul storefront). */
export const MAX_HERO_TITLE = 80;
export const MAX_HERO_TEXT = 300;
export const MAX_FEATURED = 8;

/** Grenzen der Kopf- und Fußzeile (Teil 3), gleich wie in der API. */
export const MAX_TAGLINE = 80;
export const MAX_FOOTER_TEXT = 300;
export const MAX_FOOTER_LINKS = 5;
export const MAX_LINK_LABEL = 40;

/** Erlaubte Linkziele wie in der API: https/http, mailto, tel. */
export function isSafeLinkUrl(url: string): boolean {
  return url.length <= 300 && /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()/-]+)$/i.test(url);
}

/** Eingabe ergänzen: „hallo@x.de“ → mailto:, „+49 40 …“ → tel:, „www.x.de“ → https://. */
export function completeLinkUrl(input: string): string {
  const v = input.trim();
  if (v === "" || /^(https?:|mailto:|tel:)/i.test(v)) return v;
  // Andere Schemata (javascript:, data: …) nicht „reparieren“: so sieht der Editor den Fehler.
  // Ausnahme: Port nach dem Rechnernamen, etwa „www.x.de:8080“.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^\+?[0-9][0-9 ()/-]{4,}$/.test(v)) return `tel:${v}`;
  return `https://${v}`;
}

/** Fertige Farben. Alle haben mit weißer Schrift mindestens 4,5 : 1 Kontrast. */
export const PRESETS: readonly { readonly name: string; readonly color: string }[] = [
  { name: "Salbei", color: "#3f6b4a" },
  { name: "Ozean", color: "#1f5f8b" },
  { name: "Beere", color: "#9b2c5a" },
  { name: "Terrakotta", color: "#a3462b" },
  { name: "Pflaume", color: "#5b3f8c" },
  { name: "Anthrazit", color: "#33373d" },
];

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const ROUNDED =
  'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, ' +
  '"Arial Rounded MT", "Arial Rounded MT Bold", Calibri, source-sans-pro, sans-serif';

export const FONTS: readonly {
  readonly id: Font;
  readonly name: string;
  readonly hint: string;
  readonly titel: string;
  readonly text: string;
}[] = [
  { id: "klassisch", name: "Klassisch", hint: "Überschriften mit Serifen", titel: SERIF, text: SYSTEM },
  { id: "modern", name: "Modern", hint: "Klar, ohne Serifen", titel: SYSTEM, text: SYSTEM },
  { id: "freundlich", name: "Freundlich", hint: "Weich und abgerundet", titel: ROUNDED, text: ROUNDED },
];

export function fontOf(id: Font) {
  return FONTS.find((f) => f.id === id) ?? (FONTS[0] as (typeof FONTS)[number]);
}

const HEX = /^#[0-9a-f]{6}$/;

/** `3F6B4A` oder `#3f6b4a` → `#3f6b4a`; sonst `undefined`. */
export function normalizeHex(value: string): string | undefined {
  let v = value.trim().toLowerCase();
  if (!v.startsWith("#")) v = `#${v}`;
  return HEX.test(v) ? v : undefined;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrast der Farbe zu weißer Schrift (1 bis 21). */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

export function readableWithWhite(hex: string): boolean {
  return contrastWithWhite(hex) >= 4.5;
}

/** Dunklere Fassung (wie die API): 25 % Richtung Schwarz. */
export function darker(hex: string): string {
  return `#${channels(hex)
    .map((c) =>
      Math.round(c * 0.75)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Adresse des Shops: admin.<Domain> → shop.<Domain>/<Kürzel>. */
export function storefrontUrl(handle: string, location: { protocol: string; host: string }): string {
  const host = location.host.replace(/^admin\./, "shop.");
  return `${location.protocol}//${host}/${handle}`;
}

/**
 * Design-Vorlagen (15.11.2026, nach Shopifys aktuellen Gratis-Themes): nur die Anordnung, nie Farben oder
 * Schriften (wie API und Shop). Frühere Vorlagen „zentriert“ und „boutique“ zeigen „modern“ bzw. „editorial“.
 */
export const TEMPLATES = [
  { id: "klassisch", name: "Klassisch", hint: "Logo links, Menü daneben, Bühne als Karte mit runden Ecken" },
  {
    id: "modern",
    name: "Modern",
    hint: "Logo mittig, Menü darunter, Bühne über die ganze Breite (wie Shopify Horizon)",
  },
  {
    id: "galerie",
    name: "Galerie",
    hint: "Bilder zuerst: sehr große Bühne, breite Raster, große Kategorie-Flächen (wie Fabric)",
  },
  {
    id: "editorial",
    name: "Editorial",
    hint: "Ruhig und hochwertig: geteilte Bühne, Texte mittig, Bilder im Hochformat (wie Ritual)",
  },
] as const;
export type Template = (typeof TEMPLATES)[number]["id"];
const OLD_TEMPLATES: Readonly<Record<string, Template>> = { zentriert: "modern", boutique: "editorial" };
export function templateOf(v: string | undefined): Template {
  if (TEMPLATES.some((t) => t.id === v)) return v as Template;
  return OLD_TEMPLATES[v ?? ""] ?? "klassisch";
}

// --- Editor (14.11.2026): Hintergrund, Google-Schriften, soziale Netzwerke ---

/** Dunkle Schrift des Shops; der Hintergrund muss dazu mindestens 4,5 : 1 Kontrast haben. */
export const SHOP_TEXT = "#26221e";
export const DEFAULT_BACKGROUND = "#fbf8f3";

/** Kontrast zweier Farben (1 bis 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function readableBackground(hex: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(hex) && contrast(hex.toLowerCase(), SHOP_TEXT) >= 4.5;
}

/** Farbe `a` um `anteil` (0–1) in Richtung `b` mischen (wie die Storefront für Flächen und Linien). */
export function mix(a: string, b: string, anteil: number): string {
  const [x, y] = [channels(a), channels(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + ((y[i] ?? v) - v) * anteil)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export const BACKGROUNDS: readonly { readonly name: string; readonly color: string }[] = [
  { name: "Creme", color: "#fbf8f3" },
  { name: "Weiß", color: "#ffffff" },
  { name: "Sand", color: "#f4eee4" },
  { name: "Nebel", color: "#f2f4f7" },
  { name: "Salbei", color: "#eef3ec" },
  { name: "Rosé", color: "#fbf1f0" },
];

export type FontCategory = "serif" | "sans-serif" | "display" | "handwriting" | "monospace";

/** Schrift von Google Fonts (der Shop lädt sie über Bunny Fonts, ohne Tracking). */
export interface WebFont {
  readonly id: string;
  readonly name: string;
  readonly category: FontCategory;
}

const FALLBACK: Record<FontCategory, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  "sans-serif": "system-ui, sans-serif",
  display: "system-ui, sans-serif",
  handwriting: "cursive",
  monospace: "ui-monospace, monospace",
};

export function webFontStack(f: WebFont): string {
  return `"${f.name}", ${FALLBACK[f.category]}`;
}

/** Stildatei bei Bunny Fonts für mehrere Schriften (oder `undefined`). */
export function webFontCssUrl(fonts: readonly WebFont[]): string | undefined {
  const ids = [...new Set(fonts.map((f) => f.id))].filter((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));
  if (ids.length === 0) return undefined;
  return `https://fonts.bunny.net/css?family=${ids.map((id) => `${id}:400,600,700`).join("|")}&display=swap`;
}

/** 20 bewährte Schriften als Vorschläge (alle von Google Fonts). */
export const SUGGESTED_FONTS: readonly WebFont[] = [
  { id: "playfair-display", name: "Playfair Display", category: "serif" },
  { id: "lora", name: "Lora", category: "serif" },
  { id: "merriweather", name: "Merriweather", category: "serif" },
  { id: "libre-baskerville", name: "Libre Baskerville", category: "serif" },
  { id: "cormorant-garamond", name: "Cormorant Garamond", category: "serif" },
  { id: "dm-serif-display", name: "DM Serif Display", category: "serif" },
  { id: "fraunces", name: "Fraunces", category: "serif" },
  { id: "crimson-pro", name: "Crimson Pro", category: "serif" },
  { id: "montserrat", name: "Montserrat", category: "sans-serif" },
  { id: "poppins", name: "Poppins", category: "sans-serif" },
  { id: "dm-sans", name: "DM Sans", category: "sans-serif" },
  { id: "nunito", name: "Nunito", category: "sans-serif" },
  { id: "work-sans", name: "Work Sans", category: "sans-serif" },
  { id: "raleway", name: "Raleway", category: "sans-serif" },
  { id: "manrope", name: "Manrope", category: "sans-serif" },
  { id: "outfit", name: "Outfit", category: "sans-serif" },
  { id: "karla", name: "Karla", category: "sans-serif" },
  { id: "josefin-sans", name: "Josefin Sans", category: "sans-serif" },
  { id: "space-grotesk", name: "Space Grotesk", category: "sans-serif" },
  { id: "caveat", name: "Caveat", category: "handwriting" },
];

const CATEGORY_CODES: Record<string, FontCategory> = {
  s: "serif",
  a: "sans-serif",
  d: "display",
  h: "handwriting",
  m: "monospace",
};

/** Alle Google-Schriften (Liste von Bunny Fonts, im Paket; erst beim Suchen geladen). */
export async function loadFontCatalog(): Promise<WebFont[]> {
  const list = (await import("./fonts.json")).default as [string, string, string][];
  return list.map(([id, name, c]) => ({ id, name, category: CATEGORY_CODES[c] ?? "sans-serif" }));
}

/** Suche: Anfang des Namens zuerst, dann Treffer im Namen. */
export function searchFonts(all: readonly WebFont[], query: string, limit = 30): WebFont[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const starts = all.filter((f) => f.name.toLowerCase().startsWith(q));
  const contains = all.filter((f) => !f.name.toLowerCase().startsWith(q) && f.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Soziale Netzwerke in der Fußzeile (wie API und Shop). */
export const SOCIAL: readonly { readonly id: string; readonly name: string; readonly example: string }[] = [
  { id: "instagram", name: "Instagram", example: "https://instagram.com/deinshop" },
  { id: "facebook", name: "Facebook", example: "https://facebook.com/deinshop" },
  { id: "tiktok", name: "TikTok", example: "https://tiktok.com/@deinshop" },
  { id: "youtube", name: "YouTube", example: "https://youtube.com/@deinshop" },
  { id: "pinterest", name: "Pinterest", example: "https://pinterest.com/deinshop" },
  { id: "x", name: "X", example: "https://x.com/deinshop" },
];

/** Profil-Adresse: nur https. Ergänzt „https://“, wenn es fehlt. */
export function completeSocialUrl(input: string): string {
  const v = input.trim();
  if (v === "" || /^https:\/\//i.test(v)) return v;
  if (/^http:\/\//i.test(v)) return `https://${v.slice(7)}`;
  return `https://${v}`;
}
export function isSocialUrl(url: string): boolean {
  return url.length <= 300 && /^https:\/\/[^\s<>"]+$/i.test(url);
}
