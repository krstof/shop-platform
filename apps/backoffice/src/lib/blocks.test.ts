import { describe, expect, it } from "vitest";
import {
  allBlocks,
  blockImages,
  blockProblem,
  blockSummary,
  canAdd,
  canAddTo,
  countBlocks,
  dropTarget,
  duplicateById,
  END_ZONE,
  groupZone,
  fitsInGroup,
  insertInto,
  locate,
  MAX_GROUP_BLOCKS,
  MAX_LOGOS,
  moveTo,
  removeBlock,
  updateBlock,
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

  it("prüft Videos und Buttons wie die API und räumt Texte auf", () => {
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

  it("behält Zuschnitt und Button der Bühne beim Speichern", () => {
    expect(
      cleanBlocks([
        {
          id: "buehne",
          type: "hero",
          title: " Hallo ",
          focusX: 25,
          focusY: 0,
          focusMobileX: 75,
          focusMobileY: 100,
          buttonLabel: " Jetzt stöbern ",
          buttonUrl: " /seite/tee ",
        },
      ]),
    ).toEqual([
      {
        id: "buehne",
        type: "hero",
        title: "Hallo",
        focusX: 25,
        focusY: 0,
        focusMobileX: 75,
        focusMobileY: 100,
        buttonLabel: "Jetzt stöbern",
        buttonUrl: "/seite/tee",
      },
    ]);
    // Eine Bühne ohne diese Felder bleibt, wie sie ist.
    expect(cleanBlocks([{ id: "b", type: "hero" }])).toEqual([{ id: "b", type: "hero" }]);
  });

  it("meldet ein gefährliches Ziel beim Button der Bühne", () => {
    expect(blockProblem({ id: "b", type: "hero", buttonUrl: "javascript:1" })).toBeDefined();
    expect(blockProblem({ id: "b", type: "hero", buttonUrl: "/seite/a" })).toBeUndefined();
    expect(blockProblem({ id: "b", type: "hero" })).toBeUndefined();
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

  it("legt eine Gruppe mit sichtbaren Anfangswerten an", () => {
    const g = newBlock("group", []);
    expect(g).toMatchObject({ type: "group", columns: 2, background: "flaeche", padding: "m", blocks: [] });
    expect(blockSummary(g)).toBe("Noch leer");
    // Shop-Bereiche und Gruppen gehören nicht in eine Gruppe.
    expect(fitsInGroup("text")).toBe(true);
    expect(fitsInGroup("trust")).toBe(true);
    expect(fitsInGroup("group")).toBe(false);
    expect(fitsInGroup("hero")).toBe(false);
    expect(fitsInGroup("bestseller")).toBe(false);
  });

  it("zieht Bausteine in eine Gruppe hinein und wieder heraus", () => {
    const start: Block[] = [newBlock("group", []), t("a")];
    const gid = start[0]?.id ?? "";
    // Hinein: „a“ steckt danach in der Gruppe und nicht mehr oben auf der Seite.
    const hinein = moveTo(start, "a", gid, 0);
    expect(hinein.map((b) => b.id)).toEqual([gid]);
    expect(locate(hinein, "a")).toEqual({ groupId: gid, index: 0 });
    // Heraus: wieder oben, an erster Stelle.
    const heraus = moveTo(hinein, "a", undefined, 0);
    expect(heraus.map((b) => b.id)).toEqual(["a", gid]);
    expect(locate(heraus, "a")).toEqual({ index: 0 });
    // Eine Gruppe lässt sich nicht in eine Gruppe schieben.
    const mitZwei = insertInto(hinein, gid, t("b"), 1);
    expect(moveTo(mitZwei, gid, gid, 0)).toEqual(mitZwei);
  });

  it("sortiert innerhalb einer Gruppe und ändert Bausteine auf jeder Ebene", () => {
    let blocks: Block[] = [newBlock("group", [])];
    const gid = blocks[0]?.id ?? "";
    blocks = insertInto(blocks, gid, t("k1"), 0);
    blocks = insertInto(blocks, gid, t("k2"), 1);
    const g = blocks[0];
    expect(g?.type === "group" ? g.blocks.map((b) => b.id) : []).toEqual(["k1", "k2"]);
    const sortiert = moveTo(blocks, "k2", gid, 0);
    const g2 = sortiert[0];
    expect(g2?.type === "group" ? g2.blocks.map((b) => b.id) : []).toEqual(["k2", "k1"]);
    // Ändern und Entfernen finden den Baustein auch in der Gruppe.
    const geaendert = updateBlock(sortiert, "k1", { heading: "Neu" });
    const k1 = allBlocks(geaendert).find((b) => b.id === "k1");
    expect(k1?.type === "text" ? k1.heading : "").toBe("Neu");
    const ohne = removeBlock(geaendert, "k1");
    const g3 = ohne[0];
    expect(g3?.type === "group" ? g3.blocks.map((b) => b.id) : []).toEqual(["k2"]);
  });

  it("zählt Bausteine in Gruppen mit und respektiert beide Obergrenzen", () => {
    let blocks: Block[] = [newBlock("group", [])];
    const gid = blocks[0]?.id ?? "";
    for (let i = 0; i < MAX_GROUP_BLOCKS; i++) blocks = insertInto(blocks, gid, t(`k${i}`), i);
    expect(countBlocks(blocks)).toBe(MAX_GROUP_BLOCKS + 1);
    // Die Gruppe ist voll, die Seite hat aber noch Platz.
    expect(canAddTo(blocks, gid)).toBe(false);
    expect(canAddTo(blocks, undefined)).toBe(true);
    expect(insertInto(blocks, gid, t("zuviel"), 0)).toEqual(blocks);
    // 30 insgesamt, Gruppeninhalte mitgezählt.
    const voll = [...blocks, ...Array.from({ length: 21 }, (_, i) => t(`x${i}`))];
    expect(countBlocks(voll)).toBe(30);
    expect(canAdd(voll)).toBe(false);
  });

  it("verdoppelt eine Gruppe mit neuen IDs für jeden Baustein darin", () => {
    let blocks: Block[] = [newBlock("group", [])];
    const gid = blocks[0]?.id ?? "";
    blocks = insertInto(blocks, gid, t("k1"), 0);
    blocks = insertInto(blocks, gid, t("k2"), 1);
    const kopiert = duplicateById(blocks, gid);
    expect(kopiert).toHaveLength(2);
    const ids = allBlocks(kopiert).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kopie = kopiert[1];
    expect(kopie?.type === "group" ? kopie.blocks.length : 0).toBe(2);
  });

  it("putzt Texte und sammelt Bilder auch in einer Gruppe", () => {
    const gruppe: Block = {
      id: "g",
      type: "group",
      columns: 3,
      background: "akzent",
      padding: "l",
      blocks: [
        { id: "k1", type: "text", heading: "  Hallo  ", text: "  Welt  " },
        { id: "k2", type: "image", imageId: IMG, caption: " Bild " },
      ],
    };
    const sauber = cleanBlocks([gruppe])[0];
    const kinder = sauber?.type === "group" ? sauber.blocks : [];
    expect(kinder[0]).toMatchObject({ heading: "Hallo", text: "Welt" });
    expect(kinder[1]).toMatchObject({ caption: "Bild" });
    expect(blockImages([gruppe])).toEqual([IMG]);
    expect(blockSummary(gruppe)).toBe("2 Bausteine in 3 Spalten");
    // Ein kaputter Baustein in der Gruppe meldet sich nach oben.
    const kaputt = updateBlock([gruppe], "k1", {}) as Block[];
    expect(blockProblem(kaputt[0] as Block)).toBeUndefined();
    const mitVideo = insertInto([gruppe], "g", { id: "k3", type: "video", url: "nein" }, 2);
    expect(blockProblem(mitVideo[0] as Block)).toMatch(/YouTube/);
  });

  it("entscheidet beim Ziehen, auf welcher Ebene ein Baustein landet", () => {
    let blocks: Block[] = [t("oben"), newBlock("group", [t("oben")])];
    const gid = blocks[1]?.id ?? "";
    blocks = insertInto(blocks, gid, t("k1"), 0);
    // Über dem Ende der Seite: ganz unten auf der Seite.
    expect(dropTarget(blocks, END_ZONE, "text")).toEqual({ index: 2 });
    // Über der Fläche der Gruppe: hinten in die Gruppe.
    expect(dropTarget(blocks, groupZone(gid), "text")).toEqual({ groupId: gid, index: 1 });
    // Über einem Baustein in der Gruppe: davor oder dahinter, aber in der Gruppe.
    expect(dropTarget(blocks, "k1", "text")).toEqual({ groupId: gid, index: 0 });
    expect(dropTarget(blocks, "k1", "text", true)).toEqual({ groupId: gid, index: 1 });
    // Über einem Baustein der Seite: auf der Seite.
    expect(dropTarget(blocks, "oben", "text", true)).toEqual({ index: 1 });
    // Eine Bühne und eine Gruppe passen in keine Gruppe: sie kommen direkt hinter die Gruppe.
    expect(dropTarget(blocks, groupZone(gid), "hero")).toEqual({ index: 2 });
    expect(dropTarget(blocks, "k1", "group")).toEqual({ index: 2 });
    // Unbekanntes Ziel: ans Ende der Seite.
    expect(dropTarget(blocks, "gibtsnicht", "text")).toEqual({ index: 2 });
  });

  it("legt Logo-Leiste und „So geht's“ mit brauchbaren Anfangswerten an", () => {
    const logos = newBlock("logos", []);
    expect(logos).toMatchObject({ type: "logos", heading: "", imageIds: [] });
    expect(blockSummary(logos)).toBe("Noch keine Logos");
    expect(canAddTo([logos], undefined)).toBe(true);

    const steps = newBlock("steps", []);
    expect(steps).toMatchObject({ type: "steps", heading: "So geht's" });
    expect(steps.type === "steps" ? steps.items.length : 0).toBe(3);
    expect(blockSummary(steps)).toBe("Aussuchen · Bestellen · Genießen");
    // Beide sind breite Abschnitte und gehören nicht in eine Gruppe; gezogen landen sie daneben.
    expect(fitsInGroup("logos")).toBe(false);
    expect(fitsInGroup("steps")).toBe(false);
    expect(fitsInGroup("text")).toBe(true);
  });

  it("putzt Logo-Leiste und Schritte und zählt die Logos als Bilder", () => {
    const logos: Block = { id: "l", type: "logos", heading: "  Partner  ", imageIds: [IMG] };
    const steps: Block = {
      id: "s",
      type: "steps",
      heading: "  So geht's  ",
      items: [
        { title: "  Aussuchen  ", text: "  Ein Satz  " },
        { title: "", text: "" },
      ],
    };
    const [l, st] = cleanBlocks([logos, steps]);
    expect(l).toMatchObject({ heading: "Partner" });
    expect(st).toMatchObject({ heading: "So geht's" });
    // Der leere Schritt fällt weg, wie eine leere Frage im Fragen-Baustein.
    expect(st?.type === "steps" ? st.items : []).toEqual([{ title: "Aussuchen", text: "Ein Satz" }]);
    expect(blockImages([logos])).toEqual([IMG]);
    expect(MAX_LOGOS).toBe(8);
  });
});
