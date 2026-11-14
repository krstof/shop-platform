// Bausteine der Startseite (Baukasten-Editor): Die Händlerin zieht sie in die gewünschte
// Reihenfolge. Reine Regeln ohne Datenbank. Gespeichert im Aussehen-JSON unter `home.blocks`.
// Ohne `blocks` (ältere Shops) gilt die feste Reihenfolge aus den alten Schaltern (`legacyBlocks`).
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
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const MAX_BLOCKS = 30;
export const MAX_BLOCK_HEADING = 120;
export const MAX_BLOCK_TEXT = 3000;
export const MAX_CAPTION = 200;
export const MAX_ADDRESS = 200;

const BLOCK_ID = /^[a-z0-9]{1,24}$/;

export type Block =
  | { readonly id: string; readonly type: "hero" | "featured" | "categories" | "new" }
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

/** Ein Baustein, so wie er gespeichert und über die API geschrieben wird. */
export const blockSchema = z.discriminatedUnion("type", [
  z.strictObject({ id, type: z.enum(["hero", "featured", "categories", "new"]) }),
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
]);

export const blocksSchema = z
  .array(blockSchema)
  .max(MAX_BLOCKS)
  .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, "Jeder Baustein braucht eine eigene ID.")
  .refine(
    (bs) =>
      ["hero", "featured", "categories", "new"].every((t) => bs.filter((b) => b.type === t).length <= 1),
    "Bühne, Empfehlungen, Kategorien und „Neu im Shop“ gibt es je höchstens einmal.",
  );

/** Gespeichertes JSON robust lesen: kaputte Bausteine fallen einzeln weg, ohne Liste: `null`. */
export function readBlocks(json: unknown): Block[] | null {
  if (!Array.isArray(json)) return null;
  const seen = new Set<string>();
  const single = new Set<string>();
  const out: Block[] = [];
  for (const raw of json.slice(0, MAX_BLOCKS)) {
    const r = blockSchema.safeParse(raw);
    if (!r.success || seen.has(r.data.id)) continue;
    const t = r.data.type;
    if (["hero", "featured", "categories", "new"].includes(t)) {
      if (single.has(t)) continue;
      single.add(t);
    }
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
  return (blocks ?? []).flatMap((b) =>
    (b.type === "textImage" || b.type === "image") && b.imageId !== null ? [b.imageId] : [],
  );
}

/** Eigene Inhaltsseiten (Baukasten Teil 3), etwa „Über uns“ oder „Anfahrt“. */
export const MAX_PAGES = 10;
export const MAX_PAGE_TITLE = 60;
export const MAX_PAGE_SLUG = 60;
export const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIXED = ["hero", "featured", "categories", "new"];

export interface ContentPage {
  readonly id: string;
  readonly title: string;
  /** Teil der Adresse: /<shop>/seite/<slug>. */
  readonly slug: string;
  /** Link in der Fußzeile des Shops. */
  readonly inFooter: boolean;
  /** Nur freie Bausteine (Text, Bild …), keine Shop-Bereiche. */
  readonly blocks: readonly Block[];
}

export const pageSchema = z.strictObject({
  id,
  title: line(MAX_PAGE_TITLE).refine((t) => t.trim() !== "", "Bitte einen Titel eingeben."),
  slug: z.string().max(MAX_PAGE_SLUG).regex(PAGE_SLUG, "Nur Kleinbuchstaben, Ziffern und Bindestriche."),
  inFooter: z.boolean(),
  blocks: blocksSchema.refine(
    (bs) => bs.every((b) => !FIXED.includes(b.type)),
    "Shop-Bereiche (Bühne, Empfehlungen …) gibt es nur auf der Startseite.",
  ),
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
    const blocks = (readBlocks((raw as { blocks?: unknown }).blocks) ?? []).filter(
      (b) => !FIXED.includes(b.type),
    );
    out.push({ ...head.data, blocks });
  }
  return out;
}

/** Bilder aller Seiten. */
export function pageImages(pages: readonly ContentPage[]): string[] {
  return pages.flatMap((p) => blockImages(p.blocks));
}
