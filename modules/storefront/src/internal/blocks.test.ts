import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  MAX_GROUP_BLOCKS,
  MAX_LOGOS,
  MAX_STEPS,
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

  it("nimmt die Vertrauenszeile mit höchstens drei Punkten an", () => {
    const zeile = {
      id: "v",
      type: "trust",
      items: [
        { icon: "versand", title: "Versandkostenfrei ab 50 €", text: "In 2 bis 3 Tagen da" },
        { icon: "ruecksendung", title: "30 Tage Rückgabe", text: "" },
      ],
    };
    expect(blocksSchema.safeParse([zeile]).success).toBe(true);
    expect(blocksSchema.safeParse([{ id: "v", type: "trust", items: [] }]).success).toBe(true);
    // Vier Punkte sind zu viele, und ein erfundenes Symbol gibt es nicht.
    expect(blocksSchema.safeParse([{ ...zeile, items: [...zeile.items, ...zeile.items] }]).success).toBe(
      false,
    );
    expect(
      blocksSchema.safeParse([{ id: "v", type: "trust", items: [{ icon: "einhorn", title: "a", text: "" }] }])
        .success,
    ).toBe(false);
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

  it("nimmt eine Gruppe mit Bausteinen an", () => {
    const gruppe = {
      id: "g1",
      type: "group",
      columns: 2,
      background: "flaeche",
      padding: "m",
      blocks: [
        { id: "k1", type: "text", heading: "Hallo", text: "Kurz und gut" },
        { id: "k2", type: "button", label: "Mehr", url: "/seite/ueber-uns", style: "primary" },
      ],
    };
    expect(blocksSchema.safeParse([gruppe]).success).toBe(true);
    // Eine leere Gruppe ist erlaubt; der Shop lässt sie dann einfach weg.
    expect(blocksSchema.safeParse([{ ...gruppe, blocks: [] }]).success).toBe(true);
    // Spalten nur 1 bis 3, Hintergrund und Polster nur aus der Liste.
    expect(blocksSchema.safeParse([{ ...gruppe, columns: 4 }]).success).toBe(false);
    expect(blocksSchema.safeParse([{ ...gruppe, columns: 0 }]).success).toBe(false);
    expect(blocksSchema.safeParse([{ ...gruppe, background: "neon" }]).success).toBe(false);
    expect(blocksSchema.safeParse([{ ...gruppe, padding: "xl" }]).success).toBe(false);
  });

  it("lässt in eine Gruppe keine Gruppe, keinen Shop-Bereich und höchstens acht Bausteine", () => {
    const gruppe = (blocks: unknown[]) => ({
      id: "g1",
      type: "group",
      columns: 2,
      background: "keine",
      padding: "s",
      blocks,
    });
    const text = (id: string) => ({ id, type: "text", heading: "", text: "" });
    expect(blocksSchema.safeParse([gruppe([text("k1")])]).success).toBe(true);
    // Verschachtelung geht nur eine Ebene tief.
    expect(blocksSchema.safeParse([gruppe([gruppe([])])]).success).toBe(false);
    // Shop-Bereiche brauchen Produkte und Kategorien und gehören deshalb nicht hinein.
    expect(blocksSchema.safeParse([gruppe([{ id: "k1", type: "hero" }])]).success).toBe(false);
    expect(blocksSchema.safeParse([gruppe([{ id: "k1", type: "bestseller", heading: "" }])]).success).toBe(
      false,
    );
    const zuViele = Array.from({ length: MAX_GROUP_BLOCKS + 1 }, (_, i) => text(`k${i}`));
    expect(blocksSchema.safeParse([gruppe(zuViele)]).success).toBe(false);
  });

  it("zählt Bausteine in Gruppen mit und verlangt überall eigene IDs", () => {
    const text = (id: string) => ({ id, type: "text", heading: "", text: "" });
    const gruppe = (id: string, kinder: unknown[]) => ({
      id,
      type: "group",
      columns: 1,
      background: "keine",
      padding: "s",
      blocks: kinder,
    });
    // Dieselbe ID oben und in der Gruppe wäre im Editor nicht auseinanderzuhalten.
    expect(blocksSchema.safeParse([text("a"), gruppe("g", [text("a")])]).success).toBe(false);
    expect(blocksSchema.safeParse([text("a"), gruppe("g", [text("b")])]).success).toBe(true);
    // 29 oben plus eine Gruppe mit zwei Bausteinen sind 32 und damit zu viele.
    const viele = Array.from({ length: 29 }, (_, i) => text(`x${i}`));
    expect(blocksSchema.safeParse([...viele, gruppe("g", [text("k1"), text("k2")])]).success).toBe(false);
    expect(
      blocksSchema.safeParse([...viele.slice(0, MAX_BLOCKS - 3), gruppe("g", [text("k1"), text("k2")])])
        .success,
    ).toBe(true);
  });

  it("liest eine gespeicherte Gruppe und wirft nur die kaputten Kinder weg", () => {
    const gelesen = readBlocks([
      {
        id: "g1",
        type: "group",
        columns: 2,
        background: "flaeche",
        padding: "m",
        blocks: [
          { id: "k1", type: "text", heading: "Bleibt", text: "" },
          { id: "k2", type: "video", url: 42 },
          { id: "k1", type: "text", heading: "Doppelte ID", text: "" },
          { id: "k3", type: "divider" },
        ],
      },
      { id: "kaputt", type: "einhorn" },
    ]);
    expect(gelesen).toHaveLength(1);
    const g = gelesen?.[0];
    expect(g?.type).toBe("group");
    expect(g?.type === "group" ? g.blocks.map((k) => k.id) : []).toEqual(["k1", "k3"]);
  });

  it("findet auch die Bilder in einer Gruppe", () => {
    const bilder = blockImages([
      {
        id: "g1",
        type: "group",
        columns: 2,
        background: "keine",
        padding: "s",
        blocks: [
          { id: "k1", type: "image", imageId: IMG, caption: "" },
          { id: "k2", type: "gallery", imageIds: [IMG], caption: "" },
        ],
      },
    ]);
    expect(bilder).toEqual([IMG, IMG]);
  });

  it("nimmt die Logo-Leiste und „So geht's“ an und hält sich an die Obergrenzen", () => {
    const logos = { id: "l", type: "logos", heading: "Sicher bezahlen", imageIds: [IMG] };
    expect(blocksSchema.safeParse([logos]).success).toBe(true);
    // Ohne Logos ist der Baustein erlaubt; der Shop zeigt ihn dann einfach nicht.
    expect(blocksSchema.safeParse([{ ...logos, imageIds: [] }]).success).toBe(true);
    expect(
      blocksSchema.safeParse([{ ...logos, imageIds: Array.from({ length: MAX_LOGOS + 1 }, () => IMG) }])
        .success,
    ).toBe(false);
    // Die Bilder der Logo-Leiste zählen mit, sonst würden sie beim Aufräumen gelöscht.
    expect(blockImages([{ id: "l", type: "logos", heading: "", imageIds: [IMG] }])).toEqual([IMG]);

    const steps = {
      id: "s",
      type: "steps",
      heading: "So geht's",
      items: [
        { title: "Aussuchen", text: "Stöbere durch die Sorten." },
        { title: "Bestellen", text: "" },
      ],
    };
    expect(blocksSchema.safeParse([steps]).success).toBe(true);
    expect(
      blocksSchema.safeParse([
        { ...steps, items: Array.from({ length: MAX_STEPS + 1 }, () => ({ title: "a", text: "" })) },
      ]).success,
    ).toBe(false);
    // Ein Schritt ist einzeilig: Ein Umbruch im Titel gehört nicht hinein.
    expect(blocksSchema.safeParse([{ ...steps, items: [{ title: "a\nb", text: "" }] }]).success).toBe(false);
    // Beide sind breite Abschnitte und gehören nicht in eine Gruppe.
    const gruppe = (kind: unknown) => ({
      id: "g",
      type: "group",
      columns: 2,
      background: "keine",
      padding: "s",
      blocks: [kind],
    });
    expect(blocksSchema.safeParse([gruppe(logos)]).success).toBe(false);
    expect(blocksSchema.safeParse([gruppe(steps)]).success).toBe(false);
    expect(blocksSchema.safeParse([gruppe({ id: "k", type: "text", heading: "", text: "" })]).success).toBe(
      true,
    );
  });
});
