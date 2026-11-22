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

/** Weiße Schrift auf der Hauptfarbe (Buttons) braucht mindestens dieses Kontrastverhältnis (WCAG AA). */
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

/** Netzwerke für Symbole in der Fußzeile (Reihenfolge = Reihenfolge im Shop). */
export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "youtube", "pinterest", "x"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export interface FooterSettings {
  /** Kurzer Text im Fuß (etwa Öffnungszeiten); leer heißt Standardhinweis. */
  readonly text: string;
  readonly links: readonly FooterLink[];
  /** Profile in sozialen Netzwerken (nur https-Adressen); fehlende werden nicht gezeigt. */
  readonly social: Readonly<Partial<Record<SocialNetwork, string>>>;
}

/** Schrift von Google Fonts (ausgeliefert über Bunny Fonts, ohne Tracking). */
export interface WebFont {
  /** Kennung wie „lora“ oder „dm-sans“. */
  readonly id: string;
  /** Familienname wie „Lora“. */
  readonly name: string;
  readonly category: "serif" | "sans-serif" | "display" | "handwriting" | "monospace";
}

export const FONT_CATEGORIES = ["serif", "sans-serif", "display", "handwriting", "monospace"] as const;
export const webFontSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  name: z
    .string()
    .regex(/^[A-Za-z0-9 ]+$/)
    .min(1)
    .max(60),
  category: z.enum(FONT_CATEGORIES),
});

/**
 * Design-Vorlagen: ändern nur die Anordnung (Kopf, Menü, Bühne, Kacheln), nie Farben oder Schriften.
 * „zentriert“ und „boutique“ (14.11.2026) bleiben gültig, damit alte Anfragen nicht scheitern; Shop und
 * Editor zeigen dafür „modern“ bzw. „editorial“ (15.11.2026).
 */
export const TEMPLATES = ["klassisch", "zentriert", "boutique", "modern", "galerie", "editorial"] as const;
export type Template = (typeof TEMPLATES)[number];

/** Hintergrund des Shops: hell genug, damit der dunkle Text (#26221e) gut lesbar bleibt. */
export const DEFAULT_BACKGROUND = "#fbf8f3";
export const TEXT_COLOR = "#26221e";

/** Kopfzeile des Shops (22.11.2026): Suche und Verhalten beim Scrollen. */
export const SEARCH_MODES = ["offen", "lupe", "aus"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export interface HeaderSettings {
  /** „offen“ = Suchfeld steht da, „lupe“ = Lupe, die das Feld aufklappt, „aus“ = keine Suche. */
  readonly search: SearchMode;
  /** Bleibt die Kopfzeile beim Scrollen oben stehen? */
  readonly sticky: boolean;
}

export const DEFAULT_HEADER: HeaderSettings = { search: "offen", sticky: false };

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
  /** Hintergrundfarbe des Shops. */
  readonly backgroundColor: string;
  /** Schriften von Google Fonts; `null` = die Auswahl unter `font`. */
  readonly headingFont: WebFont | null;
  readonly bodyFont: WebFont | null;
  /** Design-Vorlage (Anordnung). */
  readonly template: Template;
  /** Kopfzeile: Suche und Verhalten beim Scrollen. */
  readonly header: HeaderSettings;
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

export const DEFAULT_FOOTER: FooterSettings = { text: "", links: [], social: {} };

export const DEFAULT_DESIGN: DesignSettings = {
  accentColor: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  logoImageId: null,
  home: DEFAULT_HOME,
  tagline: "",
  footer: DEFAULT_FOOTER,
  pages: [],
  backgroundColor: DEFAULT_BACKGROUND,
  headingFont: null,
  bodyFont: null,
  template: "klassisch",
  header: DEFAULT_HEADER,
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
      social: z
        .unknown()
        .optional()
        .transform((v) => readSocial(v)),
    })
    .catch(() => ({ text: "", links: [], social: {} })),
  pages: z.unknown().optional().transform(readPages),
  backgroundColor: z.string().regex(HEX).refine(readableBackground).catch(DEFAULT_BACKGROUND),
  headingFont: webFontSchema.nullable().catch(null),
  bodyFont: webFontSchema.nullable().catch(null),
  template: z.enum(TEMPLATES).catch("klassisch"),
  header: z
    .object({
      search: z.enum(SEARCH_MODES).catch("offen"),
      sticky: z.boolean().catch(false),
    })
    .catch(() => ({ ...DEFAULT_HEADER }))
    .default(() => ({ ...DEFAULT_HEADER })),
});

/** Gespeicherte Profile lesen: nur bekannte Netzwerke mit https-Adresse. */
function readSocial(v: unknown): Partial<Record<SocialNetwork, string>> {
  if (typeof v !== "object" || v === null) return {};
  const out: Partial<Record<SocialNetwork, string>> = {};
  for (const n of SOCIAL_NETWORKS) {
    const url = (v as Record<string, unknown>)[n];
    if (typeof url === "string" && isSocialUrl(url)) out[n] = url;
  }
  return out;
}

/** Profil-Adresse: nur https, ohne Leerzeichen. */
export function isSocialUrl(url: string): boolean {
  return url.length <= MAX_LINK_URL && /^https:\/\/[^\s<>"]+$/i.test(url);
}

/** Ist der dunkle Text auf dieser Hintergrundfarbe gut lesbar (mindestens 4,5 : 1)? */
export function readableBackground(hex: string): boolean {
  return HEX.test(hex) && contrast(hex, TEXT_COLOR) >= MIN_CONTRAST;
}

/** Liest gespeichertes JSON; Fehlendes oder Kaputtes wird zum Standard (alte Shops haben `{}`). */
export function readSettings(json: unknown): DesignSettings {
  const r = stored.safeParse(typeof json === "object" && json !== null ? json : {});
  return r.success ? r.data : DEFAULT_DESIGN;
}

export function sameSettings(a: DesignSettings, b: DesignSettings): boolean {
  return canonical(a) === canonical(b);
}

/** JSON mit sortierten Schlüsseln, ohne `undefined`: gleiche Inhalte ergeben gleichen Text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null)
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
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
