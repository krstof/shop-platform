import { describe, expect, it } from "vitest";
import {
  sectionsSchema,
  storedBlockSchema,
  withSections,
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
  it("nimmt Zuschnitt-Punkt und Knopf der Bühne an und weist Unsinn ab", () => {
    const gut = sectionsSchema.safeParse({
      buehne: {
        focusX: 0,
        focusY: 100,
        focusMobileX: 25,
        focusMobileY: 75,
        buttonLabel: "Jetzt stöbern",
        buttonUrl: "/seite/ueber-uns",
      },
    });
    expect(gut.success).toBe(true);
    // Ohne Angabe bleibt alles offen: Die Bühne nimmt dann die Mitte und zeigt keinen Knopf.
    expect(sectionsSchema.safeParse({ buehne: {} }).success).toBe(true);
    expect(sectionsSchema.safeParse({ buehne: { focusX: 101 } }).success).toBe(false);
    expect(sectionsSchema.safeParse({ buehne: { focusX: -1 } }).success).toBe(false);
    expect(sectionsSchema.safeParse({ buehne: { focusY: 12.5 } }).success).toBe(false);
    // Gefährliche Ziele lässt der Knopf nicht durch.
    expect(sectionsSchema.safeParse({ buehne: { buttonUrl: "javascript:alert(1)" } }).success).toBe(false);
    expect(sectionsSchema.safeParse({ buehne: { buttonUrl: "https://example.com" } }).success).toBe(true);
    expect(sectionsSchema.safeParse({ buehne: { buttonLabel: "x".repeat(200) } }).success).toBe(false);
  });

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

  it("prüft Eingaben: Typen, Längen, doppelte IDs, Shop-Bereiche mehrfach, neue Bausteine", () => {
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
    // Shop-Bereiche dürfen mehrfach vorkommen; ihr Inhalt kommt getrennt (`sections`) und wird gespeichert.
    expect(
      blocksSchema.safeParse([
        { id: "a", type: "hero" },
        { id: "b", type: "hero" },
      ]).success,
    ).toBe(true);
    expect(blocksSchema.safeParse([{ id: "a", type: "hero", title: "x" }]).success).toBe(false);
    expect(
      withSections(
        [
          { id: "a", type: "hero" },
          { id: "t", type: "divider" },
        ],
        { a: { title: "Sommer" } },
      ),
    ).toEqual([
      { id: "a", type: "hero", title: "Sommer" },
      { id: "t", type: "divider" },
    ]);
    expect(
      storedBlockSchema.array().safeParse([
        { id: "a", type: "hero", title: "Sommer", text: "", imageId: null },
        { id: "b", type: "hero" },
        { id: "c", type: "featured", heading: "Neu", productIds: [IMG] },
      ]).success,
    ).toBe(true);
    expect(
      blocksSchema.safeParse([
        { id: "a", type: "button", label: "Los", url: "/seite/ueber-uns", style: "primary" },
        { id: "b", type: "quote", text: "Super Tee", author: "Kim" },
        { id: "c", type: "divider" },
        { id: "d", type: "faq", heading: "Fragen", items: [{ question: "Versand?", answer: "Ja." }] },
        { id: "e", type: "gallery", imageIds: [IMG], caption: "" },
      ]).success,
    ).toBe(true);
    expect(
      blocksSchema.safeParse([
        { id: "a", type: "button", label: "x", url: "javascript:alert(1)", style: "primary" },
      ]).success,
    ).toBe(false);
    expect(
      blocksSchema.safeParse([
        { id: "a", type: "button", label: "x", url: "//evil.example", style: "primary" },
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

  it("Seiten: Adresse, auch Shop-Bereiche, robust gelesen", () => {
    const page = { id: "p1", title: "Über uns", slug: "ueber-uns", inFooter: true, blocks: [] };
    expect(pagesSchema.safeParse([page]).success).toBe(true);
    expect(pagesSchema.safeParse([{ ...page, slug: "Über uns" }]).success).toBe(false);
    expect(pagesSchema.safeParse([{ ...page, title: "  " }]).success).toBe(false);
    expect(pagesSchema.safeParse([page, { ...page, id: "p2" }]).success).toBe(false);
    expect(pagesSchema.safeParse([{ ...page, blocks: [{ id: "h", type: "hero" }] }]).success).toBe(true);
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
    ).toEqual([
      {
        ...page,
        blocks: [
          { id: "h", type: "hero" },
          { id: "t", type: "spacer", size: "s" },
        ],
      },
    ]);
    expect(readPages(undefined)).toEqual([]);
  });
});
