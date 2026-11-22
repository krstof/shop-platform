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
  "bestseller",
  "trust",
  "group",
  "logos",
  "steps",
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
/** Vertrauenszeile (22.11.2026): höchstens drei Punkte, sonst glaubt sie keiner mehr. */
export const MAX_TRUST_ITEMS = 3;
export const MAX_TRUST_TITLE = 40;
export const MAX_TRUST_TEXT = 120;
/** Gruppen-Baustein (22.11.2026): Bausteine in einem Baustein, nach dem Vorbild Shopify Horizon.
 *  Eine Gruppe nimmt bis zu acht Bausteine auf und ordnet sie in einer, zwei oder drei Spalten an.
 *  Nur eine Ebene: In einer Gruppe steckt keine weitere Gruppe und kein Shop-Bereich, damit der
 *  Editor übersichtlich bleibt und die Mandantentrennung und Bildverwaltung einfach bleiben. */
export const MAX_GROUP_BLOCKS = 8;
/** Logo-Leiste (22.11.2026): kleine Logos nebeneinander, etwa Zahlungsarten, Partner oder Presse. */
export const MAX_LOGOS = 8;
/** „So geht's" (22.11.2026): höchstens vier Schritte, sonst liest sie niemand mehr. */
export const MAX_STEPS = 4;
export const MAX_STEP_TITLE = 60;
export const MAX_STEP_TEXT = 160;
/**
 * Einstellungen je Baustein (Kristof 22.11.2026, Vorbild Shopify Horizon): Abstand oben und unten,
 * Breite und Ausrichtung bei jedem Baustein, dazu Anzahl, Spalten und der Button „Alle ansehen“ bei
 * Produktlisten. Sie stehen nicht im Baustein selbst, sondern daneben in einer Liste
 * Baustein-ID → Einstellungen, genau wie der Inhalt der Shop-Bereiche (`sections`). Grund ist der
 * Vertrag der API: Jede Änderung an einem Teilschema der Baustein-Aufzählung gilt der Bruchprüfung
 * (oasdiff) als neue Art, weil sie die Teile eines `oneOf` nach ihrem Inhalt vergleicht.
 */
export const BLOCK_SPACINGS = ["s", "m", "l"] as const;
export type BlockSpacing = (typeof BLOCK_SPACINGS)[number];
export const BLOCK_WIDTHS = ["seite", "voll"] as const;
export type BlockWidth = (typeof BLOCK_WIDTHS)[number];
export const BLOCK_ALIGNS = ["links", "mitte"] as const;
export type BlockAlign = (typeof BLOCK_ALIGNS)[number];
export const LIST_COLUMNS = [2, 3, 4] as const;
export const MIN_LIST_COUNT = 2;
export const MAX_LIST_COUNT = 12;

export const GROUP_COLUMNS = [1, 2, 3] as const;
export const GROUP_BACKGROUNDS = ["keine", "flaeche", "akzent", "dunkel"] as const;
export const GROUP_PADDINGS = ["s", "m", "l"] as const;
/** Symbole der Vertrauenszeile; der Shop zeichnet sie selbst, nichts kommt von außen. */
export const TRUST_ICONS = [
  "versand",
  "ruecksendung",
  "kontakt",
  "zahlung",
  "qualitaet",
  "nachhaltig",
] as const;

/** Ziel eines Buttons: Webseite, E-Mail, Telefon oder ein Pfad im eigenen Shop („/seite/ueber-uns“). */
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

/** Einstellungen eines Bausteins. Jedes Feld freiwillig: Fehlt es, bleibt alles wie bisher. */
export const blockLayoutSchema = z.strictObject({
  spacing: z.enum(BLOCK_SPACINGS).optional(),
  width: z.enum(BLOCK_WIDTHS).optional(),
  align: z.enum(BLOCK_ALIGNS).optional(),
  count: z.int().min(MIN_LIST_COUNT).max(MAX_LIST_COUNT).optional(),
  columns: z
    .int()
    .refine((n) => (LIST_COLUMNS as readonly number[]).includes(n), "Erlaubt sind 2, 3 oder 4 Spalten.")
    .optional(),
  showAll: z.boolean().optional(),
});
export type BlockLayout = z.infer<typeof blockLayoutSchema>;

/** Einstellungen aller Bausteine einer Seite: Baustein-ID → Einstellungen. */
export const layoutsSchema = z.record(z.string().regex(BLOCK_ID), blockLayoutSchema);
export type BlockLayouts = Readonly<Record<string, BlockLayout>>;

/** Gespeicherte Einstellungen robust lesen; Kaputtes fällt einzeln weg. */
export function readLayouts(json: unknown): BlockLayouts {
  if (typeof json !== "object" || json === null) return {};
  const out: Record<string, BlockLayout> = {};
  for (const [key, value] of Object.entries(json)) {
    if (!BLOCK_ID.test(key)) continue;
    const r = blockLayoutSchema.safeParse(value);
    if (r.success && Object.keys(r.data).length > 0) out[key] = r.data;
  }
  return out;
}

/** Nur die Einstellungen behalten, zu denen es den Baustein noch gibt. */
export function keepLayouts(layouts: BlockLayouts, blocks: readonly Block[]): BlockLayouts {
  const da = new Set(allBlocks(blocks).map((b) => b.id));
  return Object.fromEntries(Object.entries(layouts).filter(([key]) => da.has(key)));
}

const SECTION_TYPES = ["hero", "featured", "categories", "new"] as const;

/** Zuschnitt-Punkt eines Bühnenbildes in Prozent: 0 ist links bzw. oben, 100 rechts bzw. unten.
 *  Fehlt er, bleibt die Mitte stehen. Am Computer und am Handy getrennt, weil ein breites Foto am
 *  Handy viel enger beschnitten wird und sonst das Falsche in der Mitte landet. */
const focus = z.int().min(0).max(100).optional();

/** Inhalt eines Shop-Bereichs (Bühne: Titel, Text, Bild, Zuschnitt, Button; Empfehlungen: Überschrift,
 *  Produkte; Neu und Kategorien: Überschrift). Fehlt ein Feld, gilt der Inhalt der Startseite bzw.
 *  der Standard. */
export const sectionContentSchema = z.strictObject({
  title: line(MAX_SECTION_TITLE).optional(),
  text: text(MAX_SECTION_TEXT).optional(),
  imageId: z.uuid().nullable().optional(),
  heading: line(MAX_SECTION_TITLE).optional(),
  productIds: z.array(z.uuid()).max(MAX_SECTION_PRODUCTS).optional(),
  focusX: focus,
  focusY: focus,
  focusMobileX: focus,
  focusMobileY: focus,
  buttonLabel: line(MAX_BUTTON_LABEL).optional(),
  buttonUrl: z
    .string()
    .max(300)
    .refine(
      (u) => u === "" || isSafeButtonUrl(u),
      "Bitte eine Webadresse, E-Mail, Telefonnummer oder /seite/… angeben.",
    )
    .optional(),
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

/** Meistverkaufte Produkte: ein Shop-Bereich, den der Shop selbst füllt. Steht getrennt, weil er
 *  nicht in eine Gruppe darf. */
const bestsellerBlock = z.strictObject({
  id,
  type: z.literal("bestseller"),
  heading: line(MAX_BLOCK_HEADING),
});

/** Neuere Bausteine (14.11.2026), die auch in eine Gruppe dürfen. */
const laterInnerBlocks = [
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
  /** Vertrauenszeile: bis zu drei kurze Punkte mit Symbol (Versand, Rückgabe, Kontakt). */
  z.strictObject({
    id,
    type: z.literal("trust"),
    items: z
      .array(
        z.strictObject({
          icon: z.enum(TRUST_ICONS),
          title: line(MAX_TRUST_TITLE),
          text: line(MAX_TRUST_TEXT),
        }),
      )
      .max(MAX_TRUST_ITEMS),
  }),
] as const;

const laterBlocks = [...laterInnerBlocks, bestsellerBlock] as const;

/**
 * Neue Arten kommen ans Ende dieser Liste, nie in die Mitte der Aufzählungen unten. Die
 * Bruchprüfung der API (oasdiff) vergleicht die Teilschemata eines `oneOf` nach ihrer Stelle:
 * Wer eine Art dazwischenschiebt, lässt alle folgenden ihre Stelle wechseln, und das meldet sie
 * als entfernte Art.
 */
const newerBlocks = [
  /** Logo-Leiste: Logos in einer Reihe, gleich hoch. Ohne Bilder zeigt der Shop nichts. */
  z.strictObject({
    id,
    type: z.literal("logos"),
    heading: line(MAX_BLOCK_HEADING),
    imageIds: z.array(z.uuid()).max(MAX_LOGOS),
  }),
  /** „So geht's“: nummerierte Schritte mit Überschrift und einem Satz. */
  z.strictObject({
    id,
    type: z.literal("steps"),
    heading: line(MAX_BLOCK_HEADING),
    items: z.array(z.strictObject({ title: line(MAX_STEP_TITLE), text: line(MAX_STEP_TEXT) })).max(MAX_STEPS),
  }),
] as const;

/**
 * Baustein, der in eine Gruppe darf: alles außer Shop-Bereichen und Gruppen selbst.
 *
 * Die Logo-Leiste und „So geht's“ gehören nicht hinein. Sie sind breite, eigenständige Abschnitte
 * (eine Reihe Logos, drei bis vier Schritte nebeneinander) und wären in einer Spalte gequetscht.
 * Dazu kommt: Eine neue Art in dieser Liste meldet die Bruchprüfung der API als entfernte Art,
 * weil sie die Teile eines `oneOf` nach ihrem Inhalt vergleicht. Soll eine Gruppe später mehr
 * aufnehmen, braucht das einen eigenen Schritt (siehe „Nachzutragen“ in STATUS.md).
 */
export const innerBlockSchema = z.discriminatedUnion("type", [...firstBlocks, ...laterInnerBlocks]);
export type InnerBlock = z.infer<typeof innerBlockSchema>;

/** Gruppe: ein Baustein, der andere Bausteine enthält (Spalten, Hintergrund, Polster je Gruppe). */
export const groupSchema = z.strictObject({
  id,
  type: z.literal("group"),
  columns: z.int().min(1).max(3),
  background: z.enum(GROUP_BACKGROUNDS),
  padding: z.enum(GROUP_PADDINGS),
  blocks: z.array(innerBlockSchema).max(MAX_GROUP_BLOCKS),
});

/** Ein Baustein, so wie er gespeichert und über die API geschrieben wird. */
export const blockSchema = z.discriminatedUnion("type", [
  sectionRefSchema,
  ...firstBlocks,
  ...laterBlocks,
  groupSchema,
  ...newerBlocks,
]);

/** Ein Baustein, wie er gespeichert ist (Shop-Bereiche mit Inhalt). */
export const storedBlockSchema = z.discriminatedUnion("type", [
  sectionSchema,
  ...firstBlocks,
  ...laterBlocks,
  groupSchema,
  ...newerBlocks,
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

/** Alle Bausteine einer Liste, Gruppen aufgelöst (für IDs, Bilder und Zählen). */
export function allBlocks<T extends { readonly type: string }>(
  blocks: readonly T[],
): readonly (T | InnerBlock)[] {
  return blocks.flatMap((b) =>
    b.type === "group" ? [b, ...((b as unknown as { blocks: InnerBlock[] }).blocks ?? [])] : [b],
  );
}

export const blocksSchema = z
  .array(blockSchema)
  .max(MAX_BLOCKS)
  .refine((bs) => {
    const ids = allBlocks(bs).map((b) => (b as { id: string }).id);
    return new Set(ids).size === ids.length;
  }, "Jeder Baustein braucht eine eigene ID.")
  .refine(
    (bs) => allBlocks(bs).length <= MAX_BLOCKS,
    `Höchstens ${MAX_BLOCKS} Bausteine, Gruppeninhalte mitgezählt.`,
  );

/** Einen gespeicherten Baustein robust lesen. Bei einer Gruppe fallen kaputte Kinder einzeln weg,
 *  statt die ganze Gruppe zu verlieren. `seen` sammelt die IDs über alle Ebenen. */
function readBlock(raw: unknown, seen: Set<string>): Block | undefined {
  if (typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "group") {
    const { blocks, ...rest } = raw as Record<string, unknown>;
    const head = groupSchema.omit({ blocks: true }).safeParse(rest);
    if (!head.success || seen.has(head.data.id)) return undefined;
    const kinder: InnerBlock[] = [];
    for (const k of (Array.isArray(blocks) ? blocks : []).slice(0, MAX_GROUP_BLOCKS)) {
      const r = innerBlockSchema.safeParse(k);
      if (!r.success || seen.has(r.data.id) || kinder.length >= MAX_GROUP_BLOCKS) continue;
      seen.add(r.data.id);
      kinder.push(r.data);
    }
    seen.add(head.data.id);
    return { ...head.data, blocks: kinder };
  }
  const r = storedBlockSchema.safeParse(raw);
  if (!r.success || seen.has(r.data.id)) return undefined;
  seen.add(r.data.id);
  return r.data as Block;
}

/** Gespeichertes JSON robust lesen: kaputte Bausteine fallen einzeln weg, ohne Liste: `null`. */
export function readBlocks(json: unknown): Block[] | null {
  if (!Array.isArray(json)) return null;
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const raw of json.slice(0, MAX_BLOCKS)) {
    const b = readBlock(raw, seen);
    if (b !== undefined) out.push(b);
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
  return allBlocks(blocks ?? []).flatMap((b) => {
    if ((b.type === "textImage" || b.type === "image" || b.type === "hero") && typeof b.imageId === "string")
      return [b.imageId];
    if (b.type === "gallery" || b.type === "logos") return [...b.imageIds];
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
  /** Einstellungen je Baustein (22.11.2026); leer heißt: alles wie bisher. */
  readonly layouts: BlockLayouts;
}

export const pageSchema = z.strictObject({
  id,
  title: line(MAX_PAGE_TITLE).refine((t) => t.trim() !== "", "Bitte einen Titel eingeben."),
  slug: z.string().max(MAX_PAGE_SLUG).regex(PAGE_SLUG, "Nur Kleinbuchstaben, Ziffern und Bindestriche."),
  inFooter: z.boolean(),
  blocks: blocksSchema,
  sections: sectionsSchema.optional(),
  layouts: layoutsSchema.optional(),
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
    // Bausteine und Einstellungen werden eigens robust gelesen: Ein kaputter Eintrag darf nicht die
    // ganze Seite wegwerfen.
    const head = pageSchema
      .omit({ blocks: true, layouts: true })
      .safeParse(Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "blocks" && k !== "layouts")));
    if (!head.success || ids.has(head.data.id) || slugs.has(head.data.slug)) continue;
    ids.add(head.data.id);
    slugs.add(head.data.slug);
    const blocks = readBlocks((raw as { blocks?: unknown }).blocks) ?? [];
    const layouts = keepLayouts(readLayouts((raw as { layouts?: unknown }).layouts), blocks);
    out.push({ ...head.data, blocks, layouts });
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
