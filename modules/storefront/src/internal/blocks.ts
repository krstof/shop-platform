// Bausteine der Startseite und eigener Seiten (Baukasten-Editor): Die Händlerin zieht sie in die
// gewünschte Reihenfolge. Reine Regeln ohne Datenbank. Gespeichert im Aussehen-JSON unter
// `home.blocks` und `pages[].blocks`. Ohne `blocks` (ältere Shops) gilt die feste Reihenfolge aus den
// alten Schaltern (`legacyBlocks`). Shop-Bereiche (Bühne, Empfehlungen …) dürfen seit 14.11.2026
// mehrfach und auf jeder Seite vorkommen und tragen ihren Inhalt selbst; fehlt er (alte Daten),
// gilt der Inhalt der Startseite (`home.heroTitle` usw.).
import { z } from "zod";

export const BLOCK_TYPES = [
  "hero",
  "featured",
  "categories",
  "new",
  "text",
  "textImage",
  "image",
  "video",
  "map",
  "spacer",
  "button",
  "quote",
  "divider",
  "faq",
  "gallery",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

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

/** Ziel eines Knopfs: Webseite, E-Mail, Telefon oder ein Pfad im eigenen Shop („/seite/ueber-uns“). */
export function isSafeButtonUrl(url: string): boolean {
  return (
    url.length <= 300 &&
    /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9 ()/-]+|\/[a-z0-9/_-]*)$/i.test(url) &&
    !url.startsWith("//")
  );
}

const BLOCK_ID = /^[a-z0-9]{1,24}$/;

/** Ein Baustein (aus dem Schema unten abgeleitet). */
export type Block = z.infer<typeof storedBlockSchema>;

/** Erlaubte Videos: YouTube und Vimeo. Wir bauen die Einbettung selbst, nie aus fremdem HTML. */
export type VideoRef = { readonly provider: "youtube" | "vimeo"; readonly id: string };

export function parseVideoUrl(url: string): VideoRef | undefined {
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

/** Zeilenumbrüche erlaubt, sonst keine Steuerzeichen. */
// eslint-disable-next-line no-control-regex -- genau diese Zeichen sind verboten
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !CONTROL.test(v), "Steuerzeichen sind nicht erlaubt.");
// eslint-disable-next-line no-control-regex -- einzeilig: keine Steuerzeichen, auch kein Umbruch
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
const line = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !SINGLE_LINE_FORBIDDEN.test(v), "Bitte nur eine Zeile.");

const id = z.string().regex(BLOCK_ID);

const SECTION_TYPES = ["hero", "featured", "categories", "new"] as const;

/** Inhalt eines Shop-Bereichs (Bühne: Titel, Text, Bild; Empfehlungen: Überschrift, Produkte; Neu und
 *  Kategorien: Überschrift). Fehlt ein Feld, gilt der Inhalt der Startseite bzw. der Standard. */
export const sectionContentSchema = z.strictObject({
  title: line(MAX_SECTION_TITLE).optional(),
  text: text(MAX_SECTION_TEXT).optional(),
  imageId: z.uuid().nullable().optional(),
  heading: line(MAX_SECTION_TITLE).optional(),
  productIds: z.array(z.uuid()).max(MAX_SECTION_PRODUCTS).optional(),
});
export type SectionContent = z.infer<typeof sectionContentSchema>;

/** Shop-Bereich, wie die API ihn seit dem Baukasten annimmt: nur ID und Art (Vertrag unverändert).
 *  Der Inhalt kommt getrennt im Feld `sections` (Baustein-ID → Inhalt). */
const sectionRefSchema = z.strictObject({ id, type: z.enum(SECTION_TYPES) });

/** Shop-Bereich, wie er gespeichert wird: mit Inhalt. */
const sectionSchema = sectionRefSchema.extend(sectionContentSchema.shape);

/** Inhalte der Shop-Bereiche je Baustein-ID (Eingabe beim Speichern). */
export const sectionsSchema = z.record(z.string().regex(BLOCK_ID), sectionContentSchema);

/** Bausteine bis 13.11.2026 (Text, Text mit Bild, Bild, Video, Karte, Abstand). */
const firstBlocks = [
  z.strictObject({
    id,
    type: z.literal("text"),
    heading: line(MAX_BLOCK_HEADING),
    text: text(MAX_BLOCK_TEXT),
  }),
  z.strictObject({
    id,
    type: z.literal("textImage"),
    heading: line(MAX_BLOCK_HEADING),
    text: text(MAX_BLOCK_TEXT),
    imageId: z.uuid().nullable(),
    imageSide: z.enum(["left", "right"]),
  }),
  z.strictObject({ id, type: z.literal("image"), imageId: z.uuid().nullable(), caption: line(MAX_CAPTION) }),
  z.strictObject({
    id,
    type: z.literal("video"),
    url: z
      .string()
      .max(300)
      .refine((u) => u === "" || parseVideoUrl(u) !== undefined, "Bitte einen Link zu YouTube oder Vimeo."),
  }),
  z.strictObject({ id, type: z.literal("map"), address: line(MAX_ADDRESS) }),
  z.strictObject({ id, type: z.literal("spacer"), size: z.enum(["s", "m", "l"]) }),
] as const;

/** Neuere Bausteine (14.11.2026). */
const laterBlocks = [
  z.strictObject({
    id,
    type: z.literal("button"),
    label: line(MAX_BUTTON_LABEL),
    url: z
      .string()
      .max(300)
      .refine(
        (u) => u === "" || isSafeButtonUrl(u),
        "Bitte eine Webadresse, E-Mail, Telefonnummer oder /seite/… angeben.",
      ),
    style: z.enum(["primary", "secondary"]),
  }),
  z.strictObject({ id, type: z.literal("quote"), text: text(MAX_QUOTE), author: line(MAX_CAPTION) }),
  z.strictObject({ id, type: z.literal("divider") }),
  z.strictObject({
    id,
    type: z.literal("faq"),
    heading: line(MAX_BLOCK_HEADING),
    items: z
      .array(z.strictObject({ question: line(MAX_BLOCK_HEADING * 2), answer: text(MAX_BLOCK_TEXT) }))
      .max(MAX_FAQ_ITEMS),
  }),
  z.strictObject({
    id,
    type: z.literal("gallery"),
    imageIds: z.array(z.uuid()).max(MAX_GALLERY),
    caption: line(MAX_CAPTION),
  }),
] as const;

/** Ein Baustein, so wie er gespeichert und über die API geschrieben wird. */
export const blockSchema = z.discriminatedUnion("type", [sectionRefSchema, ...firstBlocks, ...laterBlocks]);

/** Ein Baustein, wie er gespeichert ist (Shop-Bereiche mit Inhalt). */
export const storedBlockSchema = z.discriminatedUnion("type", [
  sectionSchema,
  ...firstBlocks,
  ...laterBlocks,
]);

/** Nur die Arten, die es bis 13.11.2026 gab: für das alte Antwortfeld `blocks` (Vertrag bleibt gleich). */
export const firstBlockSchema = z.discriminatedUnion("type", [sectionRefSchema, ...firstBlocks]);
export const FIRST_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "hero",
  "featured",
  "categories",
  "new",
  "text",
  "textImage",
  "image",
  "video",
  "map",
  "spacer",
]);

export const blocksSchema = z
  .array(blockSchema)
  .max(MAX_BLOCKS)
  .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, "Jeder Baustein braucht eine eigene ID.");

/** Gespeichertes JSON robust lesen: kaputte Bausteine fallen einzeln weg, ohne Liste: `null`. */
export function readBlocks(json: unknown): Block[] | null {
  if (!Array.isArray(json)) return null;
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const raw of json.slice(0, MAX_BLOCKS)) {
    const r = storedBlockSchema.safeParse(raw);
    if (!r.success || seen.has(r.data.id)) continue;
    seen.add(r.data.id);
    out.push(r.data as Block);
  }
  return out;
}

/** Reihenfolge, wie der Shop vor dem Baukasten aussah (aus den alten Schaltern). */
export function legacyBlocks(home: { showCategories: boolean; showNew: boolean }): Block[] {
  return [
    { id: "buehne", type: "hero" },
    { id: "empfohlen", type: "featured" },
    ...(home.showNew ? [{ id: "neu", type: "new" } as const] : []),
    ...(home.showCategories ? [{ id: "kategorien", type: "categories" } as const] : []),
  ];
}

/** Bilder, die Bausteine benutzen (für das Aufräumen nicht mehr benutzter Bilder). */
export function blockImages(blocks: readonly Block[] | null): string[] {
  return (blocks ?? []).flatMap((b) => {
    if ((b.type === "textImage" || b.type === "image" || b.type === "hero") && typeof b.imageId === "string")
      return [b.imageId];
    if (b.type === "gallery") return [...b.imageIds];
    return [];
  });
}

/** Eigene Inhaltsseiten (Baukasten Teil 3), etwa „Über uns“ oder „Anfahrt“. */
export const MAX_PAGES = 10;
export const MAX_PAGE_TITLE = 60;
export const MAX_PAGE_SLUG = 60;
export const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ContentPage {
  readonly id: string;
  readonly title: string;
  /** Teil der Adresse: /<shop>/seite/<slug>. */
  readonly slug: string;
  /** Link in der Fußzeile des Shops. */
  readonly inFooter: boolean;
  /** Bausteine wie auf der Startseite (auch Shop-Bereiche). */
  readonly blocks: readonly Block[];
}

export const pageSchema = z.strictObject({
  id,
  title: line(MAX_PAGE_TITLE).refine((t) => t.trim() !== "", "Bitte einen Titel eingeben."),
  slug: z.string().max(MAX_PAGE_SLUG).regex(PAGE_SLUG, "Nur Kleinbuchstaben, Ziffern und Bindestriche."),
  inFooter: z.boolean(),
  blocks: blocksSchema,
  sections: sectionsSchema.optional(),
});

export const pagesSchema = z
  .array(pageSchema)
  .max(MAX_PAGES)
  .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, "Jede Seite braucht eine eigene ID.")
  .refine((ps) => new Set(ps.map((p) => p.slug)).size === ps.length, "Zwei Seiten haben dieselbe Adresse.");

/** Gespeicherte Seiten robust lesen: kaputte fallen einzeln weg. */
export function readPages(json: unknown): ContentPage[] {
  if (!Array.isArray(json)) return [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const out: ContentPage[] = [];
  for (const raw of json.slice(0, MAX_PAGES)) {
    if (typeof raw !== "object" || raw === null) continue;
    const head = pageSchema
      .omit({ blocks: true })
      .safeParse(Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "blocks")));
    if (!head.success || ids.has(head.data.id) || slugs.has(head.data.slug)) continue;
    ids.add(head.data.id);
    slugs.add(head.data.slug);
    const blocks = readBlocks((raw as { blocks?: unknown }).blocks) ?? [];
    out.push({ ...head.data, blocks });
  }
  return out;
}

/** Bilder aller Seiten. */
export function pageImages(pages: readonly ContentPage[]): string[] {
  return pages.flatMap((p) => blockImages(p.blocks));
}

/** Bausteine aus der Eingabe mit den Inhalten der Shop-Bereiche zusammenführen. */
export function withSections(
  blocks: readonly z.infer<typeof blockSchema>[],
  sections: Readonly<Record<string, SectionContent>> | undefined,
): Block[] {
  return blocks.map((b) => {
    const c =
      (b.type === "hero" || b.type === "featured" || b.type === "categories" || b.type === "new") &&
      sections?.[b.id];
    return c ? ({ ...b, ...c } as Block) : (b as Block);
  });
}

/** Für das alte Antwortfeld `blocks`: nur Arten bis 13.11.2026, Shop-Bereiche ohne Inhalt. */
export function firstBlocksOf(blocks: readonly Block[]): z.infer<typeof firstBlockSchema>[] {
  return blocks.flatMap((b) => {
    if (!FIRST_BLOCK_TYPES.has(b.type)) return [];
    if (b.type === "hero" || b.type === "featured" || b.type === "categories" || b.type === "new")
      return [{ id: b.id, type: b.type }];
    return [{ ...b } as z.infer<typeof firstBlockSchema>];
  });
}
