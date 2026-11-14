import { describe, expect, it } from "vitest";
import {
  blockProblem,
  canAdd,
  cleanBlocks,
  insertAt,
  legacyBlocks,
  missingFixed,
  moveBlock,
  newBlock,
  newId,
  parseVideoUrl,
  type Block,
} from "./blocks.js";

const t = (id: string): Block => ({ id, type: "text", heading: "", text: id });

describe("Baukasten im Backoffice", () => {
  it("legt neue Bausteine mit eigener, gültiger ID an", () => {
    const blocks = [t("a")];
    const b = newBlock("textImage", blocks);
    expect(b).toMatchObject({ type: "textImage", imageId: null, imageSide: "left" });
    expect(b.id).toMatch(/^[a-z0-9]{1,24}$/);
    let n = 0;
    const fixed = () => [0, 0, 0.5][n++] ?? 0.5;
    expect(newId([{ id: "b000000", type: "hero" }], fixed)).not.toBe("b000000");
  });

  it("feste Bausteine nur einmal, höchstens 30 insgesamt", () => {
    const blocks: Block[] = [{ id: "h", type: "hero" }];
    expect(canAdd(blocks, "hero")).toBe(false);
    expect(canAdd(blocks, "featured")).toBe(true);
    expect(
      canAdd(
        Array.from({ length: 30 }, (_, i) => t(`x${i}`)),
        "text",
      ),
    ).toBe(false);
    expect(missingFixed(blocks)).toEqual(["featured", "new", "categories"]);
  });

  it("fügt ein und verschiebt", () => {
    const blocks = [t("a"), t("b"), t("c")];
    expect(insertAt(blocks, t("n"), 1).map((b) => b.id)).toEqual(["a", "n", "b", "c"]);
    expect(insertAt(blocks, t("n"), 99).map((b) => b.id)).toEqual(["a", "b", "c", "n"]);
    expect(moveBlock(blocks, 0, 2).map((b) => b.id)).toEqual(["b", "c", "a"]);
    expect(moveBlock(blocks, 2, 0).map((b) => b.id)).toEqual(["c", "a", "b"]);
    expect(moveBlock(blocks, 0, 5).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("kennt die alte Reihenfolge und prüft Videolinks wie die API", () => {
    expect(legacyBlocks({ showCategories: false }).map((b) => b.type)).toEqual(["hero", "featured", "new"]);
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("youtube");
    expect(parseVideoUrl("https://vimeo.com/76979871")?.provider).toBe("vimeo");
    expect(parseVideoUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(blockProblem({ id: "v", type: "video", url: "https://example.com" })).toBeDefined();
    expect(blockProblem({ id: "v", type: "video", url: "" })).toBeUndefined();
    expect(cleanBlocks([{ id: "m", type: "map", address: "  Teeweg 1 " }])).toEqual([
      { id: "m", type: "map", address: "Teeweg 1" },
    ]);
  });
});

describe("Eigene Seiten", () => {
  it("macht aus Titeln Adressen und hält sie eindeutig", async () => {
    const { slugify, uniqueSlug, pageProblem } = await import("./blocks.js");
    expect(slugify("Über uns")).toBe("ueber-uns");
    expect(slugify("  Anfahrt & Öffnungszeiten! ")).toBe("anfahrt-oeffnungszeiten");
    expect(slugify("???")).toBe("seite");
    const p0 = { id: "a", title: "Über uns", slug: "ueber-uns", inFooter: true, blocks: [] };
    const pages = [p0];
    expect(uniqueSlug("ueber-uns", pages)).toBe("ueber-uns-2");
    expect(uniqueSlug("ueber-uns", pages, "a")).toBe("ueber-uns");
    expect(pageProblem({ ...p0, id: "b" }, pages)).toBe("Eine andere Seite hat schon diese Adresse.");
    expect(pageProblem({ ...p0, title: " " }, pages)).toBe("Bitte einen Titel eingeben.");
    expect(pageProblem({ ...p0, slug: "Über" }, pages)).toBeDefined();
    expect(pageProblem(p0, pages)).toBeUndefined();
  });
});
