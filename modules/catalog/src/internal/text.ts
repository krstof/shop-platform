// Kleine Texthelfer für Produkte und Kategorien (M2): Adresse (slug) aus dem Namen und
// Beschreibung als strukturierter Text (Spalte `description`, kein HTML, ADR-005).

const UMLAUTE: Readonly<Record<string, string>> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** „Sencha Frühlingshauch“ → „sencha-fruehlingshauch“. Leer, wenn nichts Brauchbares übrig bleibt. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTE[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Erste freie Adresse: `basis`, sonst `basis-2`, `basis-3` … */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface RichText {
  readonly type: "doc";
  readonly content: readonly {
    readonly type: "paragraph";
    readonly content: readonly { readonly type: "text"; readonly text: string }[];
  }[];
}

/** Absätze (durch Leerzeilen getrennt) als strukturierter Text. */
export function docFromText(text: string | null | undefined): RichText {
  const paragraphs = (text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return {
    type: "doc",
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}

/** Umkehrung von docFromText: Absätze mit Leerzeile dazwischen. Unbekanntes wird übersprungen. */
export function textFromDoc(doc: unknown): string {
  if (typeof doc !== "object" || doc === null) return "";
  const content = (doc as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const paragraphs: string[] = [];
  for (const block of content as unknown[]) {
    const inner = (block as { content?: unknown } | null)?.content;
    if (!Array.isArray(inner)) continue;
    const text = (inner as unknown[])
      .map((n) => {
        const t = (n as { text?: unknown } | null)?.text;
        return typeof t === "string" ? t : "";
      })
      .join("");
    if (text !== "") paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}
