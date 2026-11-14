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
  /** Bausteine in Reihenfolge (Baukasten), nur ältere Arten; ältere API-Stände ohne. */
  readonly blocks?: readonly StoreBlock[];
  /** Alle Bausteine (seit 14.11.2026); unbekannte Arten überspringt der Shop. */
  readonly content?: readonly StoreBlock[];
}

export interface StoreBlockImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** Baustein der Startseite, wie die Storefront-API ihn liefert. */
export type StoreBlock =
  | {
      readonly id: string;
      readonly type: "hero";
      /** Ältere API-Stände ohne: dann gilt der Inhalt der Startseite. */
      readonly title?: string;
      readonly text?: string;
      readonly image?: StoreBlockImage | null;
    }
  | {
      readonly id: string;
      readonly type: "featured";
      readonly heading?: string;
      readonly productIds?: readonly string[];
    }
  | { readonly id: string; readonly type: "categories" | "new"; readonly heading?: string }
  | { readonly id: string; readonly type: "text"; readonly heading: string; readonly text: string }
  | {
      readonly id: string;
      readonly type: "textImage";
      readonly heading: string;
      readonly text: string;
      readonly image: StoreBlockImage | null;
      readonly imageSide: "left" | "right";
    }
  | { readonly id: string; readonly type: "image"; readonly image: StoreBlockImage; readonly caption: string }
  | {
      readonly id: string;
      readonly type: "video";
      readonly provider: "youtube" | "vimeo";
      readonly videoId: string;
    }
  | { readonly id: string; readonly type: "map"; readonly address: string }
  | { readonly id: string; readonly type: "spacer"; readonly size: "s" | "m" | "l" }
  | {
      readonly id: string;
      readonly type: "button";
      readonly label: string;
      readonly url: string;
      readonly style: "primary" | "secondary";
    }
  | { readonly id: string; readonly type: "quote"; readonly text: string; readonly author: string }
  | { readonly id: string; readonly type: "divider" }
  | {
      readonly id: string;
      readonly type: "faq";
      readonly heading: string;
      readonly items: readonly { readonly question: string; readonly answer: string }[];
    }
  | {
      readonly id: string;
      readonly type: "gallery";
      readonly images: readonly StoreBlockImage[];
      readonly caption: string;
    }
  | { readonly id: string; readonly type: "bestseller"; readonly heading: string };

/** Shop-Bereiche (Bühne, Empfehlungen, Neu im Shop, Kategorien, Bestseller): brauchen Produkte oder Kategorien. */
export type StoreSection = Extract<
  StoreBlock,
  { type: "hero" | "featured" | "categories" | "new" | "bestseller" }
>;
export function isSection(b: StoreBlock): b is StoreSection {
  return (
    b.type === "hero" ||
    b.type === "featured" ||
    b.type === "categories" ||
    b.type === "new" ||
    b.type === "bestseller"
  );
}

/** Ziel eines Knopfs: Pfade im Shop („/seite/x“) bekommen das Shop-Kürzel davor; sonst nur sichere Ziele. */
export function buttonHref(url: string, shop: string): string | undefined {
  if (/^\/[a-z0-9/_-]*$/i.test(url) && !url.startsWith("//")) return `/${shop}${url === "/" ? "" : url}`;
  return safeLink(url);
}

/** Soziale Netzwerke in der Fußzeile (Reihenfolge = Reihenfolge im Shop). */
export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "youtube", "pinterest", "x"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Schrift von Google Fonts (geladen über Bunny Fonts). */
export interface WebFont {
  readonly id: string;
  readonly name: string;
  readonly category: "serif" | "sans-serif" | "display" | "handwriting" | "monospace";
}

/** Bausteine; ohne Liste (ältere API) die frühere feste Reihenfolge. */
export function startseitenBausteine(home: StoreHome): readonly StoreBlock[] {
  if (home.content !== undefined) return home.content;
  if (home.blocks !== undefined) return home.blocks;
  return [
    { id: "buehne", type: "hero" },
    { id: "empfohlen", type: "featured" },
    ...(home.showNew === false ? [] : [{ id: "neu", type: "new" } as const]),
    ...(home.showCategories ? [{ id: "kategorien", type: "categories" } as const] : []),
  ];
}

/** Einbettung für Videos: wir bauen die Adresse selbst (nur bekannte Anbieter, datensparsam). */
export function videoEmbedUrl(provider: "youtube" | "vimeo", id: string): string | undefined {
  if (provider === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(id))
    return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === "vimeo" && /^\d{6,12}$/.test(id)) return `https://player.vimeo.com/video/${id}?dnt=1`;
  return undefined;
}

/** Karte von Google Maps zu einer Adresse (Einbettung und Link). */
export function mapUrls(address: string): { embed: string; link: string } {
  const q = encodeURIComponent(address.trim().slice(0, 200));
  return {
    embed: `https://www.google.com/maps?q=${q}&output=embed`,
    link: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}

/** Cookie, mit dem eine Besucherin externe Inhalte (Video, Karte) erlaubt hat. */
export const EXTERN_COOKIE = "externe-inhalte";

/** Kopf- und Fußzeile (Shop-Editor Teil 3). */
export interface StoreFooter {
  readonly text: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly social?: Readonly<Partial<Record<string, string>>>;
}

export interface StoreDesign {
  readonly accentColor: string;
  readonly accentDarkColor: string;
  readonly font: Font;
  readonly logo: StoreImageRef | null;
  readonly home: StoreHome;
  readonly tagline: string;
  readonly footer: StoreFooter;
  /** Eigene Inhaltsseiten (ältere API-Stände ohne). */
  readonly pages?: readonly StorePageRef[];
  /** Hintergrundfarbe (ältere API-Stände ohne: Creme). */
  readonly backgroundColor?: string;
  readonly headingFont?: WebFont | null;
  readonly bodyFont?: WebFont | null;
  /** Design-Vorlage (Anordnung); ältere API-Stände ohne. */
  readonly template?: string;
}

export const TEMPLATES = ["klassisch", "modern", "galerie", "editorial"] as const;
/** Frühere Vorlagen (14.11.2026) und ihr Ersatz. */
const ALTE_VORLAGEN: Readonly<Record<string, (typeof TEMPLATES)[number]>> = {
  zentriert: "modern",
  boutique: "editorial",
};
/** Vorlage für die CSS-Klasse; Unbekanntes wird „klassisch“. */
export function vorlage(design: StoreDesign): (typeof TEMPLATES)[number] {
  const t = design.template ?? "";
  if ((TEMPLATES as readonly string[]).includes(t)) return t as (typeof TEMPLATES)[number];
  return ALTE_VORLAGEN[t] ?? "klassisch";
}

/** Eintrag einer eigenen Seite im Aussehen (Inhalt kommt über /pages/{slug}). */
export interface StorePageRef {
  readonly title: string;
  readonly slug: string;
  readonly inFooter: boolean;
}

/** Eine eigene Seite mit ihren Bausteinen. */
export interface StorePage {
  readonly title: string;
  readonly slug: string;
  readonly blocks: readonly StoreBlock[];
  /** Alle Bausteine (seit 14.11.2026). */
  readonly content?: readonly StoreBlock[];
}

/** Adresse einer Seite prüfen (gleiche Regel wie die API). */
export function safePageSlug(slug: string | undefined): string | undefined {
  return slug !== undefined && slug.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? slug
    : undefined;
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
  pages: [],
};

const HEX = /^#[0-9a-f]{6}$/;

function safeColor(value: string, fallback: string): string {
  const v = value.toLowerCase();
  return HEX.test(v) ? v : fallback;
}

const FALLBACK: Record<WebFont["category"], string> = {
  serif: 'Georgia, "Times New Roman", serif',
  "sans-serif": 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  display: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  handwriting: "cursive",
  monospace: "ui-monospace, Menlo, Consolas, monospace",
};

/** Schrift sicher prüfen (Name nur Buchstaben, Ziffern, Leerzeichen; Kennung nur a–z, 0–9, Bindestrich). */
export function safeWebFont(f: WebFont | null | undefined): WebFont | undefined {
  if (f === null || f === undefined) return undefined;
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(f.name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.id)) return undefined;
  return FALLBACK[f.category] === undefined ? undefined : f;
}

/** Adresse der Schriftdatei bei Bunny Fonts (Google Fonts ohne Tracking, EU) oder `undefined`. */
export function webFontCssUrl(design: StoreDesign): string | undefined {
  const fonts = [safeWebFont(design.headingFont), safeWebFont(design.bodyFont)].filter(
    (f): f is WebFont => f !== undefined,
  );
  if (fonts.length === 0) return undefined;
  const ids = [...new Set(fonts.map((f) => f.id))];
  return `https://fonts.bunny.net/css?family=${ids.map((id) => `${id}:400,500,600,700`).join("|")}&display=swap`;
}

/** Farbe `a` um `anteil` (0–1) in Richtung `b` mischen. */
function mix(a: string, b: string, anteil: number): string {
  const ch = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + ((y[i] ?? v) - v) * anteil)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** CSS mit den Variablen des Shops. `:root:root` gewinnt sicher gegen die Standardwerte in shop.css. */
export function designCss(design: StoreDesign): string {
  const fonts = FONT_STACKS[design.font] ?? FONT_STACKS.klassisch;
  const titel = safeWebFont(design.headingFont);
  const text = safeWebFont(design.bodyFont);
  const grund = safeColor(design.backgroundColor ?? "", "#fbf8f3");
  const eigenerGrund = grund !== "#fbf8f3";
  return [
    ":root:root {",
    `  --akzent: ${safeColor(design.accentColor, DEFAULT_DESIGN.accentColor)};`,
    `  --akzent-dunkel: ${safeColor(design.accentDarkColor, DEFAULT_DESIGN.accentDarkColor)};`,
    `  --schrift-titel: ${titel ? `"${titel.name}", ${FALLBACK[titel.category]}` : fonts.titel};`,
    `  --schrift-text: ${text ? `"${text.name}", ${FALLBACK[text.category]}` : fonts.text};`,
    ...(eigenerGrund
      ? [
          `  --grund: ${grund};`,
          `  --flaeche: ${mix(grund, "#26221e", 0.05)};`,
          `  --linie: ${mix(grund, "#26221e", 0.12)};`,
        ]
      : []),
    "}",
    "",
  ].join("\n");
}

/** Kurzer Fingerabdruck für die Adresse der CSS-Datei, damit der Browser Änderungen sofort holt. */
export function designVersion(design: StoreDesign): string {
  const s = [
    design.accentColor,
    design.accentDarkColor,
    design.font,
    design.backgroundColor ?? "",
    design.headingFont?.id ?? "",
    design.headingFont?.name ?? "",
    design.bodyFont?.id ?? "",
    design.bodyFont?.name ?? "",
  ].join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
