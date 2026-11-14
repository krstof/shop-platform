import { describe, expect, it } from "vitest";
import {
  blockImages,
  blocksSchema,
  legacyBlocks,
  pagesSchema,
  parseVideoUrl,
  readBlocks,
  readPages,
} from "./blocks.js";

const IMG = "0190a3c4-0000-7000-8000-000000000001";

describe("Bausteine", () => {
  it("erkennt YouTube- und Vimeo-Links, sonst nichts", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toEqual({
      provider: "youtube",
      id: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(parseVideoUrl("https://youtube.com/shorts/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(parseVideoUrl("https://vimeo.com/76979871")).toEqual({ provider: "vimeo", id: "76979871" });
    expect(parseVideoUrl("javascript:alert(1)")).toBeUndefined();
    expect(parseVideoUrl("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(parseVideoUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(parseVideoUrl("https://www.youtube.com/watch?v=kurz")).toBeUndefined();
  });

  it("prüft Eingaben: Typen, Längen, doppelte IDs, Feste Bausteine nur einmal", () => {
    const ok = blocksSchema.safeParse([
      { id: "a", type: "hero" },
      { id: "b", type: "text", heading: "Über uns", text: "Zeile 1\nZeile 2" },
      { id: "c", type: "textImage", heading: "", text: "x", imageId: IMG, imageSide: "left" },
      { id: "d", type: "video", url: "https://youtu.be/dQw4w9WgXcQ" },
      { id: "e", type: "map", address: "Teeweg 1, Hamburg" },
      { id: "f", type: "spacer", size: "m" },
    ]);
    expect(ok.success).toBe(true);
    expect(blocksSchema.safeParse([{ id: "a", type: "video", url: "https://evil.example" }]).success).toBe(
      false,
    );
    expect(blocksSchema.safeParse([{ id: "a", type: "html", html: "<script>" }]).success).toBe(false);
    expect(
      blocksSchema.safeParse([
        { id: "a", type: "hero" },
        { id: "b", type: "hero" },
      ]).success,
    ).toBe(false);
    expect(
      blocksSchema.safeParse([
        { id: "a", type: "spacer", size: "s" },
        { id: "a", type: "spacer", size: "m" },
      ]).success,
    ).toBe(false);
    expect(blocksSchema.safeParse([{ id: "a", type: "map", address: "x\ny" }]).success).toBe(false);
  });

  it("liest gespeichertes JSON robust und kennt die alte Reihenfolge", () => {
    expect(readBlocks(undefined)).toBeNull();
    expect(
      readBlocks([{ id: "a", type: "text", heading: "", text: "ok" }, { id: "b", type: "kaputt" }, 5]),
    ).toEqual([{ id: "a", type: "text", heading: "", text: "ok" }]);
    expect(legacyBlocks({ showCategories: true, showNew: false }).map((b) => b.type)).toEqual([
      "hero",
      "featured",
      "categories",
    ]);
    expect(
      blockImages([
        { id: "a", type: "image", imageId: IMG, caption: "" },
        { id: "b", type: "textImage", heading: "", text: "", imageId: null, imageSide: "right" },
      ]),
    ).toEqual([IMG]);
  });

  it("Seiten: Adresse, keine Shop-Bereiche, robust gelesen", () => {
    const page = { id: "p1", title: "Über uns", slug: "ueber-uns", inFooter: true, blocks: [] };
    expect(pagesSchema.safeParse([page]).success).toBe(true);
    expect(pagesSchema.safeParse([{ ...page, slug: "Über uns" }]).success).toBe(false);
    expect(pagesSchema.safeParse([{ ...page, title: "  " }]).success).toBe(false);
    expect(pagesSchema.safeParse([page, { ...page, id: "p2" }]).success).toBe(false);
    expect(pagesSchema.safeParse([{ ...page, blocks: [{ id: "h", type: "hero" }] }]).success).toBe(false);
    expect(
      readPages([
        {
          ...page,
          blocks: [
            { id: "h", type: "hero" },
            { id: "t", type: "spacer", size: "s" },
          ],
        },
        { ...page, id: "p2" },
        "kaputt",
      ]),
    ).toEqual([{ ...page, blocks: [{ id: "t", type: "spacer", size: "s" }] }]);
    expect(readPages(undefined)).toEqual([]);
  });
});
