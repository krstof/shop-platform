import { describe, expect, it } from "vitest";
import { docFromText, firstFreeSlug, slugify, textFromDoc } from "./text.js";

describe("Texthelfer (M2)", () => {
  it("macht aus Namen gültige Adressen", () => {
    expect(slugify("Sencha Frühlingshauch")).toBe("sencha-fruehlingshauch");
    expect(slugify("  Größe XL – Crème brûlée! ")).toBe("groesse-xl-creme-brulee");
    expect(slugify("☕☕")).toBe("");
    expect(slugify("a".repeat(100))).toHaveLength(80);
  });

  it("hängt bei Gleichstand eine Zahl an", () => {
    expect(firstFreeSlug("tee", new Set())).toBe("tee");
    expect(firstFreeSlug("tee", new Set(["tee", "tee-2"]))).toBe("tee-3");
  });

  it("Beschreibung hin und zurück: Absätze bleiben erhalten", () => {
    const text = "Erster Absatz.\nmit Umbruch\n\n\nZweiter Absatz.";
    const doc = docFromText(text);
    expect(doc.content).toHaveLength(2);
    expect(textFromDoc(doc)).toBe("Erster Absatz.\nmit Umbruch\n\nZweiter Absatz.");
    expect(textFromDoc(docFromText(null))).toBe("");
    expect(textFromDoc({ type: "doc", content: [{ type: "image" }, null] })).toBe("");
  });
});
