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
  | "bestseller"
  | "trust"
  | "logos"
  | "steps"
  | "group";
export type BlockType = FixedType | FreeType;

/** Baustein, der in eine Gruppe darf: alles außer Shop-Bereichen und Gruppen selbst. „bestseller“
 *  gehört auch nicht hinein, weil der Shop ihn als eigenen Bereich mit Produkten zeichnet; die
 *  Logo-Leiste und „So geht's“ sind breite, eigenständige Abschnitte und wären in einer Spalte
 *  gequetscht (gleiche Liste wie in der API). */
export type InnerType = Exclude<FreeType, "group" | "bestseller" | "logos" | "steps">;

/** Inhalt eines Shop-Bereichs. Fehlende Felder: Inhalt der Startseite bzw. Standard. */
export interface SectionContent {
  readonly title?: string;
  readonly text?: string;
  readonly imageId?: string | null;
  readonly heading?: string;
  readonly productIds?: readonly string[];
  /** Bühne: Zuschnitt-Punkt des Bildes in Prozent, am Computer und am Handy getrennt. */
  readonly focusX?: number;
  readonly focusY?: number;
  readonly focusMobileX?: number;
  readonly focusMobileY?: number;
  /** Bühne: Button unter dem Text. Ohne Beschriftung oder ohne Ziel zeigt der Shop keinen. */
  readonly buttonLabel?: string;
  readonly buttonUrl?: string;
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
  | { readonly id: string; readonly type: "bestseller"; readonly heading: string }
  | {
      readonly id: string;
      readonly type: "trust";
      readonly items: readonly {
        readonly icon: TrustIcon;
        readonly title: string;
        readonly text: string;
      }[];
    }
  | {
      readonly id: string;
      readonly type: "logos";
      readonly heading: string;
      readonly imageIds: readonly string[];
    }
  | {
      readonly id: string;
      readonly type: "steps";
      readonly heading: string;
      readonly items: readonly { readonly title: string; readonly text: string }[];
    }
  | {
      readonly id: string;
      readonly type: "group";
      /** Spalten am Computer (1 bis 3); am Handy steht alles untereinander. */
      readonly columns: number;
      readonly background: GroupBackground;
      readonly padding: GroupPadding;
      readonly blocks: readonly InnerBlock[];
    };

/** Baustein in einer Gruppe (nie ein Shop-Bereich, nie selbst eine Gruppe). */
export type InnerBlock = Extract<Block, { type: InnerType }>;
export type GroupBlock = Extract<Block, { type: "group" }>;

/** Symbole der Vertrauenszeile (gleiche Liste wie in der API). */
export const TRUST_ICONS = [
  { id: "versand", name: "Versand" },
  { id: "ruecksendung", name: "Rückgabe" },
  { id: "kontakt", name: "Kontakt" },
  { id: "zahlung", name: "Zahlung" },
  { id: "qualitaet", name: "Qualität" },
  { id: "nachhaltig", name: "Nachhaltig" },
] as const;
export type TrustIcon = (typeof TRUST_ICONS)[number]["id"];
export const MAX_TRUST_ITEMS = 3;
export const MAX_TRUST_TITLE = 40;
export const MAX_TRUST_TEXT = 120;

/** Gruppen-Baustein (22.11.2026, Vorbild Shopify Horizon): Bausteine in einem Baustein. Nur eine Ebene,
 *  in einer Gruppe steckt also keine weitere Gruppe und kein Shop-Bereich. */
export const MAX_GROUP_BLOCKS = 8;
/** Logo-Leiste und „So geht's" (22.11.2026), gleiche Grenzen wie in der API. */
export const MAX_LOGOS = 8;
export const MAX_STEPS = 4;
export const MAX_STEP_TITLE = 60;
export const MAX_STEP_TEXT = 160;
export const GROUP_COLUMNS = [1, 2, 3] as const;
export const GROUP_BACKGROUNDS = [
  { id: "keine", name: "Keiner" },
  { id: "flaeche", name: "Hell" },
  { id: "akzent", name: "Hauptfarbe" },
  { id: "dunkel", name: "Dunkel" },
] as const;
export type GroupBackground = (typeof GROUP_BACKGROUNDS)[number]["id"];
export const GROUP_PADDINGS = [
  { id: "s", name: "Klein" },
  { id: "m", name: "Mittel" },
  { id: "l", name: "Groß" },
] as const;
export type GroupPadding = (typeof GROUP_PADDINGS)[number]["id"];

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
  button: { name: "Button", hint: "Link zu einer Seite" },
  quote: { name: "Zitat", hint: "Stimme einer Kundin" },
  faq: { name: "Fragen", hint: "Aufklappbare Antworten" },
  divider: { name: "Linie", hint: "Trennt Abschnitte" },
  spacer: { name: "Abstand", hint: "Etwas Luft" },
  hero: { name: "Bühne", hint: "Großes Bild mit Text" },
  featured: { name: "Empfehlungen", hint: "Ausgewählte Produkte" },
  new: { name: "Neu im Shop", hint: "Neueste Produkte" },
  bestseller: { name: "Bestseller", hint: "Meistverkaufte Produkte" },
  categories: { name: "Kategorien", hint: "Kacheln" },
  trust: { name: "Vertrauen", hint: "Versand, Rückgabe, Kontakt" },
  group: { name: "Gruppe", hint: "Bausteine in Spalten" },
  logos: { name: "Logos", hint: "Zahlungsarten, Partner" },
  steps: { name: "So geht's", hint: "Schritte mit Nummer" },
};

/** Gruppen in der Leiste „Bausteine“. */
export const PALETTE: readonly { readonly title: string; readonly types: readonly BlockType[] }[] = [
  { title: "Inhalte", types: ["text", "textImage", "image", "gallery", "logos", "video", "map"] },
  {
    title: "Gestaltung",
    types: ["group", "button", "quote", "faq", "trust", "steps", "divider", "spacer"],
  },
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
    case "trust":
      return {
        id,
        type,
        items: [
          { icon: "versand", title: "Versandkostenfrei ab 50 €", text: "Lieferung in 2 bis 3 Tagen" },
          { icon: "ruecksendung", title: "30 Tage Rückgabe", text: "Ohne Angabe von Gründen" },
          { icon: "kontakt", title: "Wir sind da", text: "Montags bis freitags von 9 bis 18 Uhr" },
        ],
      };
    case "logos":
      return { id, type, heading: "", imageIds: [] };
    case "steps":
      return {
        id,
        type,
        heading: "So geht's",
        items: [
          { title: "Aussuchen", text: "" },
          { title: "Bestellen", text: "" },
          { title: "Genießen", text: "" },
        ],
      };
    case "group":
      // Mit Hintergrund und zwei Spalten sieht man sofort, was eine Gruppe ist.
      return { id, type, columns: 2, background: "flaeche", padding: "m", blocks: [] };
    case "hero":
      return { id, type, title: "", text: "", imageId: null };
    case "featured":
      return { id, type, heading: "", productIds: [] };
    default:
      return { id, type, heading: "" };
  }
}

/** Alle Bausteine, Gruppen aufgelöst (zum Zählen, für IDs und Bilder). */
export function allBlocks(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((b): Block[] => (b.type === "group" ? [b, ...b.blocks] : [b]));
}

/** Wie viele Bausteine stehen auf der Seite, Gruppeninhalte mitgezählt? */
export function countBlocks(blocks: readonly Block[]): number {
  return allBlocks(blocks).length;
}

/** Ob noch ein Baustein passt (Gruppeninhalte zählen mit). */
export function canAdd(blocks: readonly Block[]): boolean {
  return countBlocks(blocks) < MAX_BLOCKS;
}

/** Ob in diese Gruppe (oder oben auf der Seite, wenn `groupId` fehlt) noch ein Baustein passt. */
export function canAddTo(blocks: readonly Block[], groupId?: string): boolean {
  if (!canAdd(blocks)) return false;
  if (groupId === undefined) return true;
  const g = blockById(blocks, groupId);
  return g?.type === "group" && g.blocks.length < MAX_GROUP_BLOCKS;
}

/** Darf diese Art in eine Gruppe? Shop-Bereiche und Gruppen selbst dürfen nicht. */
export function fitsInGroup(type: BlockType): type is InnerType {
  return (
    type !== "group" &&
    type !== "hero" &&
    type !== "featured" &&
    type !== "new" &&
    type !== "bestseller" &&
    type !== "categories" &&
    type !== "logos" &&
    type !== "steps"
  );
}

/** Einen Baustein über alle Ebenen finden. */
export function blockById(blocks: readonly Block[], id: string): Block | undefined {
  return allBlocks(blocks).find((b) => b.id === id);
}

/** Wo steckt ein Baustein? `groupId` fehlt, wenn er oben auf der Seite liegt. */
export function locate(
  blocks: readonly Block[],
  id: string,
): { readonly groupId?: string; readonly index: number } | undefined {
  const oben = blocks.findIndex((b) => b.id === id);
  if (oben >= 0) return { index: oben };
  for (const b of blocks) {
    if (b.type !== "group") continue;
    const i = b.blocks.findIndex((k) => k.id === id);
    if (i >= 0) return { groupId: b.id, index: i };
  }
  return undefined;
}

/** Bausteine einer Ebene: die Gruppe mit `groupId` oder die Seite selbst. */
export function blocksOf(blocks: readonly Block[], groupId?: string): readonly Block[] {
  if (groupId === undefined) return blocks;
  const g = blockById(blocks, groupId);
  return g?.type === "group" ? g.blocks : [];
}

/** Einen Baustein ändern, auf welcher Ebene er auch steckt. */
export function updateBlock(blocks: readonly Block[], id: string, change: Partial<Block>): Block[] {
  return blocks.map((b): Block => {
    if (b.id === id) return { ...b, ...change } as Block;
    if (b.type !== "group") return b;
    if (!b.blocks.some((k) => k.id === id)) return b;
    return { ...b, blocks: b.blocks.map((k) => (k.id === id ? ({ ...k, ...change } as InnerBlock) : k)) };
  });
}

/** Einen Baustein entfernen, auf welcher Ebene er auch steckt (eine Gruppe nimmt ihren Inhalt mit). */
export function removeBlock(blocks: readonly Block[], id: string): Block[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b): Block => (b.type === "group" ? { ...b, blocks: b.blocks.filter((k) => k.id !== id) } : b));
}

/** Einen Baustein einfügen: oben auf der Seite oder in eine Gruppe. */
export function insertInto(
  blocks: readonly Block[],
  groupId: string | undefined,
  block: Block,
  index: number,
): Block[] {
  if (groupId === undefined) return insertAt(blocks, block, index);
  if (!fitsInGroup(block.type)) return [...blocks];
  const inner = block as InnerBlock;
  return blocks.map((b): Block => {
    if (b.type !== "group" || b.id !== groupId) return b;
    if (b.blocks.length >= MAX_GROUP_BLOCKS) return b;
    const i = Math.max(0, Math.min(index, b.blocks.length));
    return { ...b, blocks: [...b.blocks.slice(0, i), inner, ...b.blocks.slice(i)] };
  });
}

/** Einen Baustein verschieben: innerhalb seiner Ebene oder in eine andere Ebene. */
export function moveTo(
  blocks: readonly Block[],
  id: string,
  groupId: string | undefined,
  index: number,
): Block[] {
  const from = locate(blocks, id);
  const block = blockById(blocks, id);
  if (from === undefined || block === undefined) return [...blocks];
  if (groupId !== undefined && !fitsInGroup(block.type)) return [...blocks];
  if (from.groupId === groupId) {
    if (groupId === undefined)
      return moveBlock(blocks, from.index, Math.max(0, Math.min(index, blocks.length - 1)));
    return blocks.map((b): Block => {
      if (b.type !== "group" || b.id !== groupId) return b;
      const ziel = Math.max(0, Math.min(index, b.blocks.length - 1));
      if (ziel === from.index) return b;
      const next = [...b.blocks];
      const [x] = next.splice(from.index, 1);
      if (x !== undefined) next.splice(ziel, 0, x);
      return { ...b, blocks: next };
    });
  }
  if (groupId !== undefined && !canAddTo(blocks, groupId)) return [...blocks];
  return insertInto(removeBlock(blocks, id), groupId, block, index);
}

/** Ablageflächen beim Ziehen: das Ende der Seite und das Innere jeder Gruppe. */
export const END_ZONE = "ende";
export const GROUP_ZONE_PREFIX = "gruppe:";
export const groupZone = (id: string): string => `${GROUP_ZONE_PREFIX}${id}`;

/** Wohin kommt ein Baustein, den man über `overId` loslässt? Ergebnis ist die Ebene (Seite oder
 *  Gruppe) und der Platz darin. Was nicht in eine Gruppe darf (Shop-Bereiche, Gruppen selbst),
 *  landet stattdessen direkt hinter der Gruppe auf der Seite. */
export function dropTarget(
  blocks: readonly Block[],
  overId: string,
  type: BlockType,
  after = false,
): { readonly groupId?: string; readonly index: number } {
  const ziel = ((): { groupId?: string; index: number } => {
    if (overId === END_ZONE) return { index: blocks.length };
    if (overId.startsWith(GROUP_ZONE_PREFIX)) {
      const gid = overId.slice(GROUP_ZONE_PREFIX.length);
      const g = blockById(blocks, gid);
      if (g?.type !== "group") return { index: blocks.length };
      return { groupId: gid, index: g.blocks.length };
    }
    const l = locate(blocks, overId);
    if (l === undefined) return { index: blocks.length };
    const i = after ? l.index + 1 : l.index;
    return l.groupId === undefined ? { index: i } : { groupId: l.groupId, index: i };
  })();
  if (ziel.groupId === undefined || fitsInGroup(type)) return ziel;
  const g = locate(blocks, ziel.groupId);
  return { index: (g?.index ?? blocks.length - 1) + 1 };
}

/** Einen Baustein verdoppeln, auf welcher Ebene er auch steckt. Eine Gruppe nimmt ihren Inhalt mit,
 *  jeder Baustein der Kopie bekommt dabei eine eigene neue ID. */
export function duplicateById(blocks: readonly Block[], id: string): Block[] {
  const stelle = locate(blocks, id);
  const block = blockById(blocks, id);
  if (stelle === undefined || block === undefined) return [...blocks];
  if (!canAddTo(blocks, stelle.groupId)) return [...blocks];
  const dazu = block.type === "group" ? 1 + block.blocks.length : 1;
  if (countBlocks(blocks) + dazu > MAX_BLOCKS) return [...blocks];
  const belegt: { id: string }[] = allBlocks(blocks).map((b) => ({ id: b.id }));
  const frisch = (): string => {
    const neu = newId(belegt);
    belegt.push({ id: neu });
    return neu;
  };
  const kopie: Block =
    block.type === "group"
      ? { ...block, id: frisch(), blocks: block.blocks.map((k) => ({ ...k, id: frisch() })) }
      : { ...block, id: frisch() };
  return insertInto(blocks, stelle.groupId, kopie, stelle.index + 1);
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

/** Ziel eines Buttons: Webseite, E-Mail, Telefon oder Pfad im Shop („/seite/ueber-uns“). */
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
  if (b.type === "hero" && (b.buttonUrl ?? "").trim() !== "" && !isSafeButtonUrl((b.buttonUrl ?? "").trim()))
    return "Bitte eine Webadresse (https://…), E-Mail (mailto:…) oder eine eigene Seite wählen.";
  if (b.type === "group") return b.blocks.map(blockProblem).find((x) => x !== undefined);
  return undefined;
}

/** Baustein, der in eine Gruppe darf (Prüfung auf dem Wert, nicht nur auf der Art). */
export function isInnerBlock(b: Block): b is InnerBlock {
  return fitsInGroup(b.type);
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
    case "trust":
      return b.items.length === 0
        ? "Noch keine Punkte"
        : b.items.map((i) => i.title.trim() || "…").join(", ");
    case "logos":
      return b.imageIds.length === 0 ? "Noch keine Logos" : `${b.imageIds.length} Logos`;
    case "steps":
      return b.items.length === 0
        ? "Noch keine Schritte"
        : b.items.map((i) => i.title.trim() || "…").join(" · ");
    case "group":
      return b.blocks.length === 0
        ? "Noch leer"
        : `${b.blocks.length} ${b.blocks.length === 1 ? "Baustein" : "Bausteine"} in ${b.columns} ${
            b.columns === 1 ? "Spalte" : "Spalten"
          }`;
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
      case "logos":
        return { ...b, heading: b.heading.trim() };
      case "steps":
        return {
          ...b,
          heading: b.heading.trim(),
          items: b.items
            .map((i) => ({ title: i.title.trim(), text: i.text.trim() }))
            .filter((i) => i.title !== "" || i.text !== ""),
        };
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
      case "group":
        return { ...b, blocks: cleanBlocks(b.blocks).filter(isInnerBlock) };
      case "trust":
        return {
          ...b,
          items: b.items
            .map((i) => ({ icon: i.icon, title: i.title.trim(), text: i.text.trim() }))
            .filter((i) => i.title !== "" || i.text !== ""),
        };
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
        for (const k of ["focusX", "focusY", "focusMobileX", "focusMobileY"] as const) {
          if (b[k] !== undefined) c[k] = b[k];
        }
        if (b.buttonLabel !== undefined) c["buttonLabel"] = trim(b.buttonLabel);
        if (b.buttonUrl !== undefined) c["buttonUrl"] = trim(b.buttonUrl);
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

/** Bilder, die Bausteine benutzen (auch die in Gruppen). */
export function blockImages(blocks: readonly Block[]): string[] {
  return allBlocks(blocks).flatMap((b) => {
    if ((b.type === "textImage" || b.type === "image" || b.type === "hero") && typeof b.imageId === "string")
      return [b.imageId];
    if (b.type === "gallery" || b.type === "logos") return [...b.imageIds];
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
