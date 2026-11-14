// Baukasten-Editor: Bausteine der Startseite und eigener Seiten im Backoffice. Dieselben Regeln prüft
// die API (Modul storefront, internal/blocks.ts); hier nur, damit der Editor sofort reagiert.
// Shop-Bereiche (Bühne, Empfehlungen, Neu im Shop, Kategorien) dürfen mehrfach vorkommen und tragen
// ihren Inhalt selbst; beim Speichern geht dieser Inhalt getrennt im Feld `sections` an die API.

export type FixedType = "hero" | "featured" | "categories" | "new";
export type FreeType =
  | "text"
  | "textImage"
  | "image"
  | "video"
  | "map"
  | "spacer"
  | "button"
  | "quote"
  | "divider"
  | "faq"
  | "gallery"
  | "bestseller";
export type BlockType = FixedType | FreeType;

/** Inhalt eines Shop-Bereichs. Fehlende Felder: Inhalt der Startseite bzw. Standard. */
export interface SectionContent {
  readonly title?: string;
  readonly text?: string;
  readonly imageId?: string | null;
  readonly heading?: string;
  readonly productIds?: readonly string[];
}

export type Block =
  | ({ readonly id: string; readonly type: FixedType } & SectionContent)
  | { readonly id: string; readonly type: "text"; readonly heading: string; readonly text: string }
  | {
      readonly id: string;
      readonly type: "textImage";
      readonly heading: string;
      readonly text: string;
      readonly imageId: string | null;
      readonly imageSide: "left" | "right";
    }
  | { readonly id: string; readonly type: "image"; readonly imageId: string | null; readonly caption: string }
  | { readonly id: string; readonly type: "video"; readonly url: string }
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
      readonly imageIds: readonly string[];
      readonly caption: string;
    }
  | { readonly id: string; readonly type: "bestseller"; readonly heading: string };

export const MAX_BLOCKS = 30;
export const MAX_BLOCK_HEADING = 120;
export const MAX_BLOCK_TEXT = 3000;
export const MAX_CAPTION = 200;
export const MAX_ADDRESS = 200;
export const MAX_BUTTON_LABEL = 40;
export const MAX_QUOTE = 600;
export const MAX_FAQ_ITEMS = 12;
export const MAX_GALLERY = 8;
export const MAX_SECTION_TITLE = 80;
export const MAX_SECTION_TEXT = 300;
export const MAX_SECTION_PRODUCTS = 8;

export function isSection(b: Block): b is Extract<Block, { type: FixedType }> {
  return b.type === "hero" || b.type === "featured" || b.type === "categories" || b.type === "new";
}

/** Name und kurze Erklärung je Baustein (Leiste und Ansagen für Screenreader). */
export const BLOCK_INFO: Record<BlockType, { readonly name: string; readonly hint: string }> = {
  text: { name: "Text", hint: "Überschrift und Absatz" },
  textImage: { name: "Text mit Bild", hint: "Bild links oder rechts" },
  image: { name: "Bild", hint: "Großes Foto" },
  gallery: { name: "Galerie", hint: "Bis zu 8 Bilder" },
  video: { name: "Video", hint: "YouTube oder Vimeo" },
  map: { name: "Karte", hint: "Google Maps" },
  button: { name: "Knopf", hint: "Link zu einer Seite" },
  quote: { name: "Zitat", hint: "Stimme einer Kundin" },
  faq: { name: "Fragen", hint: "Aufklappbare Antworten" },
  divider: { name: "Linie", hint: "Trennt Abschnitte" },
  spacer: { name: "Abstand", hint: "Etwas Luft" },
  hero: { name: "Bühne", hint: "Großes Bild mit Text" },
  featured: { name: "Empfehlungen", hint: "Ausgewählte Produkte" },
  new: { name: "Neu im Shop", hint: "Neueste Produkte" },
  bestseller: { name: "Bestseller", hint: "Meistverkaufte Produkte" },
  categories: { name: "Kategorien", hint: "Kacheln" },
};

/** Gruppen in der Leiste „Bausteine“. */
export const PALETTE: readonly { readonly title: string; readonly types: readonly BlockType[] }[] = [
  { title: "Inhalte", types: ["text", "textImage", "image", "gallery", "video", "map"] },
  { title: "Gestaltung", types: ["button", "quote", "faq", "divider", "spacer"] },
  { title: "Shop-Bereiche", types: ["hero", "featured", "new", "bestseller", "categories"] },
];

/** Zufallszahl in [0, 1) aus crypto (Math.random ist im Projekt gesperrt). */
function cryptoRandom(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}

/** Kurze, neue ID (Kleinbuchstaben und Ziffern, wie die API verlangt). */
export function newId(
  existing: readonly { readonly id: string }[],
  random: () => number = cryptoRandom,
): string {
  const taken = new Set(existing.map((b) => b.id));
  for (;;) {
    const id = `b${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** Neuer Baustein mit sinnvollen Anfangswerten. */
export function newBlock(type: BlockType, existing: readonly Block[], random?: () => number): Block {
  const id = newId(existing, random);
  switch (type) {
    case "text":
      return { id, type, heading: "", text: "" };
    case "textImage":
      return { id, type, heading: "", text: "", imageId: null, imageSide: "left" };
    case "image":
      return { id, type, imageId: null, caption: "" };
    case "video":
      return { id, type, url: "" };
    case "map":
      return { id, type, address: "" };
    case "spacer":
      return { id, type, size: "m" };
    case "button":
      return { id, type, label: "Mehr erfahren", url: "", style: "primary" };
    case "quote":
      return { id, type, text: "", author: "" };
    case "divider":
      return { id, type };
    case "faq":
      return { id, type, heading: "Häufige Fragen", items: [{ question: "", answer: "" }] };
    case "gallery":
      return { id, type, imageIds: [], caption: "" };
    case "bestseller":
      return { id, type, heading: "Bestseller" };
    case "hero":
      return { id, type, title: "", text: "", imageId: null };
    case "featured":
      return { id, type, heading: "", productIds: [] };
    default:
      return { id, type, heading: "" };
  }
}

/** Ob noch ein Baustein passt. */
export function canAdd(blocks: readonly Block[]): boolean {
  return blocks.length < MAX_BLOCKS;
}

/** Baustein an Stelle `index` einfügen (am Ende, wenn außerhalb). */
export function insertAt(blocks: readonly Block[], block: Block, index: number): Block[] {
  const i = Math.max(0, Math.min(index, blocks.length));
  return [...blocks.slice(0, i), block, ...blocks.slice(i)];
}

/** Baustein von `from` nach `to` verschieben. */
export function moveBlock(blocks: readonly Block[], from: number, to: number): Block[] {
  if (from === to || from < 0 || from >= blocks.length || to < 0 || to >= blocks.length) return [...blocks];
  const next = [...blocks];
  const [b] = next.splice(from, 1);
  if (b !== undefined) next.splice(to, 0, b);
  return next;
}

/** Kopie direkt dahinter (mit neuer ID). */
export function duplicateBlock(blocks: readonly Block[], index: number): Block[] {
  const b = blocks[index];
  if (b === undefined || !canAdd(blocks)) return [...blocks];
  return insertAt(blocks, { ...b, id: newId(blocks) } as Block, index + 1);
}

interface LegacyHome {
  readonly heroImage?: { readonly id: string } | null;
  readonly heroTitle: string;
  readonly heroText: string;
  readonly featuredProductIds: readonly string[];
  readonly showCategories: boolean;
  readonly showNew?: boolean;
}

/** Shop-Bereiche ohne eigenen Inhalt (alte Daten) bekommen den Inhalt der Startseite. */
export function fillSections(blocks: readonly Block[], home: LegacyHome): Block[] {
  return blocks.map((b) => {
    if (b.type === "hero")
      return {
        ...b,
        title: b.title ?? home.heroTitle,
        text: b.text ?? home.heroText,
        imageId: b.imageId === undefined ? (home.heroImage?.id ?? null) : b.imageId,
      };
    if (b.type === "featured")
      return { ...b, heading: b.heading ?? "", productIds: b.productIds ?? [...home.featuredProductIds] };
    if (b.type === "categories" || b.type === "new") return { ...b, heading: b.heading ?? "" };
    return b;
  });
}

/** Reihenfolge, wie der Shop vor dem Baukasten aussah (gleich wie in der API), mit Inhalt. */
export function legacyBlocks(home: LegacyHome): Block[] {
  return fillSections(
    [
      { id: "buehne", type: "hero" },
      { id: "empfohlen", type: "featured" },
      ...((home.showNew ?? true) ? [{ id: "neu", type: "new" } as const] : []),
      ...(home.showCategories ? [{ id: "kategorien", type: "categories" } as const] : []),
    ],
    home,
  );
}

/** Erlaubte Videos: YouTube und Vimeo (gleiche Regel wie die API). */
export function parseVideoUrl(url: string): { provider: "youtube" | "vimeo"; id: string } | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const yt = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return yt.test(id) ? { provider: "youtube", id } : undefined;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (u.pathname === "/watch" && v !== null && yt.test(v)) return { provider: "youtube", id: v };
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/);
    return m?.[1] === undefined ? undefined : { provider: "youtube", id: m[1] };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/(?:video\/)?(\d{6,12})\/?$/);
    return m?.[1] === undefined ? undefined : { provider: "vimeo", id: m[1] };
  }
  return undefined;
}

/** Ziel eines Knopfs: Webseite, E-Mail, Telefon oder Pfad im Shop („/seite/ueber-uns“). */
export function isSafeButtonUrl(url: string): boolean {
  return (
    url.length <= 300 &&
    /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()/-]+|\/[a-z0-9/_-]*)$/i.test(url) &&
    !url.startsWith("//")
  );
}

/** Fehlertext für einen Baustein oder `undefined`. Leere Bausteine sind erlaubt (der Shop lässt sie weg). */
export function blockProblem(b: Block): string | undefined {
  if (b.type === "video" && b.url.trim() !== "" && parseVideoUrl(b.url) === undefined)
    return "Bitte einen Link zu einem YouTube- oder Vimeo-Video einfügen.";
  if (b.type === "button" && b.url.trim() !== "" && !isSafeButtonUrl(b.url.trim()))
    return "Bitte eine Webadresse (https://…), E-Mail (mailto:…) oder eine eigene Seite wählen.";
  return undefined;
}

/** Kurzbeschreibung für Screenreader und Listen. */
export function blockSummary(b: Block): string {
  switch (b.type) {
    case "text":
    case "textImage":
      return b.heading.trim() || b.text.trim().slice(0, 60) || "Noch leer";
    case "image":
      return b.caption.trim() || (b.imageId === null ? "Noch kein Bild" : "Bild");
    case "gallery":
      return b.imageIds.length === 0 ? "Noch keine Bilder" : `${b.imageIds.length} Bilder`;
    case "video":
      return b.url.trim() === "" ? "Noch kein Video" : b.url.trim();
    case "map":
      return b.address.trim() || "Noch keine Adresse";
    case "spacer":
      return { s: "Klein", m: "Mittel", l: "Groß" }[b.size];
    case "button":
      return b.label.trim() || "Ohne Beschriftung";
    case "quote":
      return b.text.trim().slice(0, 60) || "Noch leer";
    case "faq":
      return b.heading.trim() || "Fragen";
    case "divider":
      return "Linie";
    case "hero":
      return b.title?.trim() || "Begrüßung";
    default:
      return b.heading?.trim() || BLOCK_INFO[b.type].hint;
  }
}

const trim = (s: string | undefined) => (s === undefined ? undefined : s.trim());

/** Fürs Speichern: Texte ohne Leerzeichen am Rand, leere Fragen weg. */
export function cleanBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b): Block => {
    switch (b.type) {
      case "text":
      case "textImage":
        return { ...b, heading: b.heading.trim(), text: b.text.trim() };
      case "image":
      case "gallery":
        return { ...b, caption: b.caption.trim() };
      case "video":
        return { ...b, url: b.url.trim() };
      case "map":
        return { ...b, address: b.address.trim() };
      case "button":
        return { ...b, label: b.label.trim(), url: b.url.trim() };
      case "quote":
        return { ...b, text: b.text.trim(), author: b.author.trim() };
      case "bestseller":
        return { ...b, heading: b.heading.trim() };
      case "faq":
        return {
          ...b,
          heading: b.heading.trim(),
          items: b.items
            .map((i) => ({ question: i.question.trim(), answer: i.answer.trim() }))
            .filter((i) => i.question !== "" || i.answer !== ""),
        };
      case "hero":
      case "featured":
      case "categories":
      case "new": {
        const c: Record<string, unknown> = { id: b.id, type: b.type };
        if (b.title !== undefined) c["title"] = trim(b.title);
        if (b.text !== undefined) c["text"] = trim(b.text);
        if (b.imageId !== undefined) c["imageId"] = b.imageId;
        if (b.heading !== undefined) c["heading"] = trim(b.heading);
        if (b.productIds !== undefined) c["productIds"] = [...b.productIds];
        return c as Block;
      }
      default:
        return b;
    }
  });
}

/** Für die API: Shop-Bereiche nur mit ID und Art, ihr Inhalt getrennt in `sections`. */
export function splitSections(blocks: readonly Block[]): {
  blocks: Block[];
  sections: Record<string, SectionContent>;
} {
  const sections: Record<string, SectionContent> = {};
  const out = cleanBlocks(blocks).map((b): Block => {
    if (!isSection(b)) return b;
    const { id, type, ...content } = b;
    if (Object.keys(content).length > 0) sections[id] = content;
    return { id, type };
  });
  return { blocks: out, sections };
}

/** Bilder, die Bausteine benutzen. */
export function blockImages(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) => {
    if ((b.type === "textImage" || b.type === "image" || b.type === "hero") && typeof b.imageId === "string")
      return [b.imageId];
    if (b.type === "gallery") return [...b.imageIds];
    return [];
  });
}

/** Eigene Inhaltsseiten (Baukasten Teil 3), gleiche Grenzen wie die API. */
export const MAX_PAGES = 10;
export const MAX_PAGE_TITLE = 60;
export const MAX_PAGE_SLUG = 60;

export interface ContentPage {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly inFooter: boolean;
  readonly blocks: readonly Block[];
}

/** Adresse aus dem Titel: „Über uns“ → „ueber-uns“. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PAGE_SLUG)
    .replace(/-+$/g, "");
  return s === "" ? "seite" : s;
}

/** Freie Adresse: hängt -2, -3 … an, wenn eine andere Seite sie schon hat. */
export function uniqueSlug(wanted: string, pages: readonly ContentPage[], ownId?: string): string {
  const taken = new Set(pages.filter((p) => p.id !== ownId).map((p) => p.slug));
  if (!taken.has(wanted)) return wanted;
  for (let i = 2; ; i++) {
    const s = `${wanted.slice(0, MAX_PAGE_SLUG - String(i).length - 1)}-${i}`;
    if (!taken.has(s)) return s;
  }
}

/** Fehlertext für eine Seite oder `undefined`. */
export function pageProblem(p: ContentPage, pages: readonly ContentPage[]): string | undefined {
  if (p.title.trim() === "") return "Bitte einen Titel eingeben.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) || p.slug.length > MAX_PAGE_SLUG)
    return "Die Adresse darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.";
  if (pages.some((o) => o.id !== p.id && o.slug === p.slug))
    return "Eine andere Seite hat schon diese Adresse.";
  return p.blocks.map(blockProblem).find((x) => x !== undefined);
}
