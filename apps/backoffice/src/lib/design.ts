// Shop-Editor Teil 1: fertige Farben, Schriften und die Kontrastprüfung für die Vorschau.
// Dieselben Regeln prüft die API (Modul storefront), die Schriften stehen auch in der Storefront
// (apps/storefront/src/lib/design.ts). Hier nur, damit der Editor sofort reagiert.

export type Font = "klassisch" | "modern" | "freundlich";

/** Grenzen der Startseite (Shop-Editor Teil 2), gleich wie in der API (Modul storefront). */
export const MAX_HERO_TITLE = 80;
export const MAX_HERO_TEXT = 300;
export const MAX_FEATURED = 8;

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
