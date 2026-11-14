// Baukasten-Editor (Teil 2): Bausteine der Startseite im Backoffice. Dieselben Regeln prüft die API
// (Modul storefront, internal/blocks.ts); hier nur, damit der Editor sofort reagiert.

export type FixedType = "hero" | "featured" | "categories" | "new";
export type FreeType = "text" | "textImage" | "image" | "video" | "map" | "spacer";
export type BlockType = FixedType | FreeType;

export type Block =
  | { readonly id: string; readonly type: FixedType }
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
  | { readonly id: string; readonly type: "spacer"; readonly size: "s" | "m" | "l" };

export const MAX_BLOCKS = 30;
export const MAX_BLOCK_HEADING = 120;
export const MAX_BLOCK_TEXT = 3000;
export const MAX_CAPTION = 200;
export const MAX_ADDRESS = 200;

export const FIXED_TYPES: readonly FixedType[] = ["hero", "featured", "new", "categories"];

/** Name, Symbol und kurze Erklärung je Baustein (Leiste und Liste). */
export const BLOCK_INFO: Record<
  BlockType,
  { readonly name: string; readonly icon: string; readonly hint: string }
> = {
  text: { name: "Text", icon: "¶", hint: "Überschrift und Absatz" },
  textImage: { name: "Text mit Bild", icon: "▤", hint: "Bild links oder rechts daneben" },
  image: { name: "Bild", icon: "▣", hint: "Ein großes Foto, mit Bildunterschrift" },
  video: { name: "Video", icon: "▶", hint: "YouTube oder Vimeo" },
  map: { name: "Karte", icon: "⌖", hint: "Google Maps zu einer Adresse" },
  spacer: { name: "Abstand", icon: "↕", hint: "Etwas Luft zwischen Bausteinen" },
  hero: { name: "Bühne", icon: "★", hint: "Großes Bild mit Begrüßung" },
  featured: { name: "Empfehlungen", icon: "♥", hint: "Deine hervorgehobenen Produkte" },
  new: { name: "Neu im Shop", icon: "✦", hint: "Die vier neuesten Produkte" },
  categories: { name: "Kategorien", icon: "▦", hint: "Kategorien als Kacheln" },
};

export const PALETTE_FREE: readonly FreeType[] = ["text", "textImage", "image", "video", "map", "spacer"];

/** Feste Bausteine gibt es je höchstens einmal: nur die fehlenden stehen in der Leiste. */
export function missingFixed(blocks: readonly Block[]): FixedType[] {
  return FIXED_TYPES.filter((t) => !blocks.some((b) => b.type === t));
}

/** Zufallszahl in [0, 1) aus crypto (Math.random ist im Projekt gesperrt). */
function cryptoRandom(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}

/** Kurze, neue ID (Kleinbuchstaben und Ziffern, wie die API verlangt). */
export function newId(existing: readonly Block[], random: () => number = cryptoRandom): string {
  const taken = new Set(existing.map((b) => b.id));
  for (;;) {
    const id = `b${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** Neuer Baustein mit leeren Feldern. */
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
    default:
      return { id, type };
  }
}

/** Ob ein neuer Baustein dieser Art noch passt. */
export function canAdd(blocks: readonly Block[], type: BlockType): boolean {
  if (blocks.length >= MAX_BLOCKS) return false;
  return !(FIXED_TYPES as readonly string[]).includes(type) || !blocks.some((b) => b.type === type);
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

/** Reihenfolge, wie der Shop vor dem Baukasten aussah (gleich wie in der API). */
export function legacyBlocks(home: { showCategories: boolean; showNew?: boolean }): Block[] {
  return [
    { id: "buehne", type: "hero" },
    { id: "empfohlen", type: "featured" },
    ...((home.showNew ?? true) ? [{ id: "neu", type: "new" } as const] : []),
    ...(home.showCategories ? [{ id: "kategorien", type: "categories" } as const] : []),
  ];
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

/** Fehlertext für einen Baustein oder `undefined`. Leere Bausteine sind erlaubt (der Shop lässt sie weg). */
export function blockProblem(b: Block): string | undefined {
  if (b.type === "video" && b.url.trim() !== "" && parseVideoUrl(b.url) === undefined)
    return "Bitte einen Link zu einem YouTube- oder Vimeo-Video einfügen.";
  return undefined;
}

/** Kurzbeschreibung für die Liste, etwa die Überschrift oder Adresse. */
export function blockSummary(b: Block): string {
  switch (b.type) {
    case "text":
    case "textImage":
      return b.heading.trim() || b.text.trim().slice(0, 60) || "Noch leer";
    case "image":
      return b.caption.trim() || (b.imageId === null ? "Noch kein Bild" : "Bild");
    case "video":
      return b.url.trim() === "" ? "Noch kein Video" : b.url.trim();
    case "map":
      return b.address.trim() || "Noch keine Adresse";
    case "spacer":
      return { s: "Klein", m: "Mittel", l: "Groß" }[b.size];
    default:
      return BLOCK_INFO[b.type].hint;
  }
}

/** Fürs Speichern: Texte ohne Leerzeichen am Rand. */
export function cleanBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => {
    switch (b.type) {
      case "text":
        return { ...b, heading: b.heading.trim(), text: b.text.trim() };
      case "textImage":
        return { ...b, heading: b.heading.trim(), text: b.text.trim() };
      case "image":
        return { ...b, caption: b.caption.trim() };
      case "video":
        return { ...b, url: b.url.trim() };
      case "map":
        return { ...b, address: b.address.trim() };
      default:
        return b;
    }
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
