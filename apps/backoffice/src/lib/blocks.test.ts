import { describe, expect, it } from "vitest";
import {
  blockImages,
  blockProblem,
  canAdd,
  cleanBlocks,
  duplicateBlock,
  fillSections,
  insertAt,
  legacyBlocks,
  moveBlock,
  newBlock,
  newId,
  pageProblem,
  parseVideoUrl,
  slugify,
  splitSections,
  uniqueSlug,
  type Block,
} from "./blocks.js";

const t = (id: string): Block => ({ id, type: "text", heading: "", text: id });
const IMG = "0190a3c4-0000-7000-8000-000000000001";

describe("Baukasten im Backoffice", () => {
  it("legt neue Bausteine mit eigener, gültiger ID an", () => {
    const blocks = [t("a")];
    const b = newBlock("textImage", blocks);
    expect(b).toMatchObject({ type: "textImage", imageId: null, imageSide: "left" });
    expect(b.id).toMatch(/^[a-z0-9]{1,24}$/);
    expect(newBlock("faq", blocks)).toMatchObject({ items: [{ question: "", answer: "" }] });
    let n = 0;
    const fixed = () => [0, 0, 0.5][n++] ?? 0.5;
    expect(newId([{ id: "b000000" }], fixed)).not.toBe("b000000");
  });

  it("Shop-Bereiche mehrfach, höchstens 30 insgesamt", () => {
    expect(canAdd([{ id: "h", type: "hero" }])).toBe(true);
    expect(canAdd(Array.from({ length: 30 }, (_, i) => t(`x${i}`)))).toBe(false);
  });

  it("fügt ein, verschiebt und verdoppelt", () => {
    const blocks = [t("a"), t("b"), t("c")];
    expect(insertAt(blocks, t("n"), 1).map((b) => b.id)).toEqual(["a", "n", "b", "c"]);
    expect(insertAt(blocks, t("n"), 99).map((b) => b.id)).toEqual(["a", "b", "c", "n"]);
    expect(moveBlock(blocks, 0, 2).map((b) => b.id)).toEqual(["b", "c", "a"]);
    expect(moveBlock(blocks, 0, 5).map((b) => b.id)).toEqual(["a", "b", "c"]);
    const d = duplicateBlock(blocks, 0);
    expect(d).toHaveLength(4);
    expect(d[1]).toMatchObject({ type: "text", text: "a" });
    expect(d[1]?.id).not.toBe("a");
  });

  it("übernimmt alten Startseiten-Inhalt und trennt ihn fürs Speichern", () => {
    const home = {
      heroImage: { id: IMG },
      heroTitle: "Hallo",
      heroText: "Text",
      featuredProductIds: ["p1"],
      showCategories: false,
    };
    const legacy = legacyBlocks(home);
    expect(legacy.map((b) => b.type)).toEqual(["hero", "featured", "new"]);
    expect(legacy[0]).toEqual({ id: "buehne", type: "hero", title: "Hallo", text: "Text", imageId: IMG });
    expect(fillSections([{ id: "h", type: "hero", title: "Eigen" }], home)[0]).toMatchObject({
      title: "Eigen",
      text: "Text",
    });
    const { blocks, sections } = splitSections([...legacy, t("x")]);
    expect(blocks[0]).toEqual({ id: "buehne", type: "hero" });
    expect(sections["buehne"]).toEqual({ title: "Hallo", text: "Text", imageId: IMG });
    expect(sections["empfohlen"]).toEqual({ heading: "", productIds: ["p1"] });
    expect(blockImages(legacy)).toEqual([IMG]);
  });

  it("prüft Videos und Knöpfe wie die API und räumt Texte auf", () => {
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("youtube");
    expect(parseVideoUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(blockProblem({ id: "v", type: "video", url: "https://example.com" })).toBeDefined();
    expect(
      blockProblem({ id: "b", type: "button", label: "x", url: "javascript:1", style: "primary" }),
    ).toBeDefined();
    expect(
      blockProblem({ id: "b", type: "button", label: "x", url: "/seite/a", style: "primary" }),
    ).toBeUndefined();
    expect(
      cleanBlocks([
        {
          id: "f",
          type: "faq",
          heading: " F ",
          items: [
            { question: " ", answer: "" },
            { question: "a", answer: "b" },
          ],
        },
      ]),
    ).toEqual([{ id: "f", type: "faq", heading: "F", items: [{ question: "a", answer: "b" }] }]);
  });
});

describe("Eigene Seiten", () => {
  it("macht aus Titeln Adressen und hält sie eindeutig", () => {
    expect(slugify("Über uns")).toBe("ueber-uns");
    expect(slugify("  Anfahrt & Öffnungszeiten! ")).toBe("anfahrt-oeffnungszeiten");
    expect(slugify("???")).toBe("seite");
    const p0 = { id: "a", title: "Über uns", slug: "ueber-uns", inFooter: true, blocks: [] };
    const pages = [p0];
    expect(uniqueSlug("ueber-uns", pages)).toBe("ueber-uns-2");
    expect(uniqueSlug("ueber-uns", pages, "a")).toBe("ueber-uns");
    expect(pageProblem({ ...p0, id: "b" }, pages)).toBe("Eine andere Seite hat schon diese Adresse.");
    expect(pageProblem({ ...p0, title: " " }, pages)).toBe("Bitte einen Titel eingeben.");
    expect(pageProblem(p0, pages)).toBeUndefined();
  });
});
