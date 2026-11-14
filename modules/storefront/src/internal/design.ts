// Aussehen eines Shops: Hauptfarbe, Schrift, Logo (Shop-Editor Teil 1) und Startseite (Teil 2:
// großes Bild mit Überschrift und Text, hervorgehobene Produkte, Kategorien-Kacheln). Reine Rechenregeln ohne
// Datenbank, damit sie einzeln getestet werden können. Gespeichert wird als JSON in
// storefront.theme_installation (settings_draft und settings_published).
import { z } from "zod";
import { blockImages, pageImages, readBlocks, readPages, type Block, type ContentPage } from "./blocks.js";

/** Schriftarten: nur Systemschriften, keine Dienste von außen (Stil „schlicht“, 29.10.2026). */
export const FONTS = ["klassisch", "modern", "freundlich"] as const;
export type Font = (typeof FONTS)[number];

/** Standard: wie der Shop vor dem Editor aussah (Salbeigrün, Überschriften mit Serifen). */
export const DEFAULT_ACCENT = "#3f6b4a";
export const DEFAULT_FONT: Font = "klassisch";

/** Weiße Schrift auf der Hauptfarbe (Knöpfe) braucht mindestens dieses Kontrastverhältnis (WCAG AA). */
export const MIN_CONTRAST = 4.5;

/** Höchstlängen der Texte auf der Startseite und Anzahl hervorgehobener Produkte. */
export const MAX_HERO_TITLE = 80;
export const MAX_HERO_TEXT = 300;
export const MAX_FEATURED = 8;

/** Startseite (Teil 2). Leere Überschrift oder leerer Text: der Shop zeigt seinen Standardtext. */
export interface HomeSettings {
  readonly heroImageId: string | null;
  readonly heroTitle: string;
  readonly heroText: string;
  /** Produkt-IDs in der gewünschten Reihenfolge. Gelöschte oder versteckte zeigt der Shop einfach nicht. */
  readonly featuredProductIds: readonly string[];
  readonly showCategories: boolean;
  /** Abschnitt „Neu im Shop“ mit den vier neuesten Produkten. */
  readonly showNew: boolean;
  /** Bausteine in Reihenfolge (Baukasten); `null` = alte feste Reihenfolge aus den Schaltern. */
  readonly blocks: readonly Block[] | null;
}

/** Kopf- und Fußzeile (Teil 3). */
export const MAX_TAGLINE = 80;
export const MAX_FOOTER_TEXT = 300;
export const MAX_FOOTER_LINKS = 5;
export const MAX_LINK_LABEL = 40;
export const MAX_LINK_URL = 300;

/** Erlaubte Linkziele: Webseiten (https/http), E-Mail, Telefon. Nie javascript: oder data:. */
const LINK_URL = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()/-]+)$/i;

export function isSafeLinkUrl(url: string): boolean {
  return url.length <= MAX_LINK_URL && LINK_URL.test(url);
}

export interface FooterLink {
  readonly label: string;
  readonly url: string;
}

export interface FooterSettings {
  /** Kurzer Text im Fuß (etwa Öffnungszeiten); leer heißt Standardhinweis. */
  readonly text: string;
  readonly links: readonly FooterLink[];
}

export interface DesignSettings {
  readonly accentColor: string;
  readonly font: Font;
  readonly logoImageId: string | null;
  readonly home: HomeSettings;
  /** Kurzer Text unter dem Logo (Slogan); leer heißt keiner. */
  readonly tagline: string;
  readonly footer: FooterSettings;
  /** Eigene Inhaltsseiten (Baukasten Teil 3). */
  readonly pages: readonly ContentPage[];
}

export const DEFAULT_HOME: HomeSettings = {
  heroImageId: null,
  heroTitle: "",
  heroText: "",
  featuredProductIds: [],
  showCategories: true,
  showNew: true,
  blocks: null,
};

export const DEFAULT_FOOTER: FooterSettings = { text: "", links: [] };

export const DEFAULT_DESIGN: DesignSettings = {
  accentColor: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  logoImageId: null,
  home: DEFAULT_HOME,
  tagline: "",
  footer: DEFAULT_FOOTER,
  pages: [],
};

const HEX = /^#[0-9a-f]{6}$/;

const stored = z.object({
  accentColor: z.string().regex(HEX).catch(DEFAULT_ACCENT),
  font: z.enum(FONTS).catch(DEFAULT_FONT),
  logoImageId: z.uuid().nullable().catch(null),
  home: z
    .object({
      heroImageId: z.uuid().nullable().catch(null),
      heroTitle: z.string().max(MAX_HERO_TITLE).catch(""),
      heroText: z.string().max(MAX_HERO_TEXT).catch(""),
      featuredProductIds: z.array(z.uuid()).max(MAX_FEATURED).catch([]),
      showCategories: z.boolean().catch(true),
      showNew: z.boolean().catch(true),
      blocks: z.unknown().optional().transform(readBlocks),
    })
    .catch(() => ({ ...DEFAULT_HOME, featuredProductIds: [], blocks: null })),
  tagline: z.string().max(MAX_TAGLINE).catch(""),
  footer: z
    .object({
      text: z.string().max(MAX_FOOTER_TEXT).catch(""),
      links: z
        .array(
          z.object({
            label: z.string().min(1).max(MAX_LINK_LABEL),
            url: z.string().refine(isSafeLinkUrl),
          }),
        )
        .max(MAX_FOOTER_LINKS)
        .catch([]),
    })
    .catch(() => ({ text: "", links: [] })),
  pages: z.unknown().optional().transform(readPages),
});

/** Liest gespeichertes JSON; Fehlendes oder Kaputtes wird zum Standard (alte Shops haben `{}`). */
export function readSettings(json: unknown): DesignSettings {
  const r = stored.safeParse(typeof json === "object" && json !== null ? json : {});
  return r.success ? r.data : DEFAULT_DESIGN;
}

export function sameSettings(a: DesignSettings, b: DesignSettings): boolean {
  return (
    a.accentColor === b.accentColor &&
    a.font === b.font &&
    a.logoImageId === b.logoImageId &&
    a.home.heroImageId === b.home.heroImageId &&
    a.home.heroTitle === b.home.heroTitle &&
    a.home.heroText === b.home.heroText &&
    a.home.showCategories === b.home.showCategories &&
    a.home.showNew === b.home.showNew &&
    JSON.stringify(a.home.blocks) === JSON.stringify(b.home.blocks) &&
    a.home.featuredProductIds.join(",") === b.home.featuredProductIds.join(",") &&
    a.tagline === b.tagline &&
    a.footer.text === b.footer.text &&
    JSON.stringify(a.footer.links) === JSON.stringify(b.footer.links) &&
    JSON.stringify(a.pages) === JSON.stringify(b.pages)
  );
}

/** Alle Bilder (Logo, Startseitenbild), die ein Stand benutzt. */
export function imagesOf(s: DesignSettings): string[] {
  return [s.logoImageId, s.home.heroImageId, ...blockImages(s.home.blocks), ...pageImages(s.pages)].filter(
    (x): x is string => x !== null,
  );
}

/** `#AbC123` → `#abc123`; `undefined`, wenn es keine Farbe in dieser Form ist. */
export function normalizeHex(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  return HEX.test(v) ? v : undefined;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative Leuchtdichte nach WCAG 2.2. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis zweier Farben (1 bis 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ist weiße Schrift auf dieser Farbe gut lesbar? */
export function readableWithWhite(hex: string): boolean {
  return contrast(hex, "#ffffff") >= MIN_CONTRAST;
}

/** Dunklere Fassung für „Maus darüber“ und Links: 25 % Richtung Schwarz. */
export function darker(hex: string): string {
  return toHex(channels(hex).map((c) => c * 0.75) as [number, number, number]);
}
