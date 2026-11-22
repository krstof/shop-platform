// Umrechnung zwischen dem Zustand des Editors und der API: Kopfzeile mit Leiste oben und Symbol des
// Shops (Kristof 22.11.2026). Prüft, dass nichts verloren geht und was gespeichert wird.
import { describe, expect, it } from "vitest";
import type { Design, DesignState } from "../../lib/api.js";
import { bodyOf, formOf } from "./form.js";

const leeresDesign: Design = {
  accentColor: "#3f6b4a",
  font: "klassisch",
  logo: null,
  home: {
    heroImage: null,
    heroTitle: "",
    heroText: "",
    featuredProductIds: [],
    showCategories: true,
    showNew: true,
  },
  tagline: "",
  footer: { text: "", links: [] },
  pages: [],
};

const zustand = (design: Partial<Design>): DesignState => {
  const d = { ...leeresDesign, ...design };
  return { draft: d, published: d, hasUnpublishedChanges: false, publishedAt: null, version: 1 };
};

const symbol = {
  id: "0190a3c4-0000-7000-8000-000000000009",
  url: "https://media.example/sym.png",
  thumbnailUrl: "https://media.example/sym-klein.png",
  width: 64,
  height: 64,
};

describe("Editor-Formular: Einstellungen je Baustein", () => {
  it("trennt die Einstellungen von den Bausteinen und lässt die Spalten der Gruppe stehen", () => {
    const form = formOf(zustand({}));
    const body = bodyOf({
      ...form,
      blocks: [
        { id: "t1", type: "text", heading: "Hallo", text: "Welt", spacing: "l", align: "mitte" },
        { id: "f1", type: "featured", count: 6, columns: 3, showAll: true },
        {
          id: "g1",
          type: "group",
          columns: 2,
          background: "keine",
          padding: "m",
          width: "voll",
          blocks: [{ id: "k1", type: "quote", text: "Ein Zitat", author: "", spacing: "s" }],
        },
      ],
    });
    // Die Bausteine selbst tragen die Einstellungen nicht mehr …
    expect(body.home.blocks).toEqual([
      { id: "t1", type: "text", heading: "Hallo", text: "Welt" },
      { id: "f1", type: "featured" },
      {
        id: "g1",
        type: "group",
        columns: 2,
        background: "keine",
        padding: "m",
        blocks: [{ id: "k1", type: "quote", text: "Ein Zitat", author: "" }],
      },
    ]);
    // … sie stehen daneben, auch die der Bausteine in der Gruppe.
    expect(body.home.layouts).toEqual({
      t1: { spacing: "l", align: "mitte" },
      f1: { count: 6, columns: 3, showAll: true },
      g1: { width: "voll" },
      k1: { spacing: "s" },
    });
  });

  it("liest die Einstellungen aus der Antwort der API wieder in die Bausteine", () => {
    const form = formOf(
      zustand({
        home: {
          ...leeresDesign.home,
          content: [
            { id: "t1", type: "text", heading: "Hallo", text: "", spacing: "l" },
            { id: "f1", type: "featured", heading: "", productIds: [], count: 4 },
          ],
        },
      }),
    );
    expect(form.blocks[0]).toMatchObject({ id: "t1", spacing: "l" });
    expect(form.blocks[1]).toMatchObject({ id: "f1", count: 4 });
  });
});

describe("Editor-Formular: Leiste oben und Symbol", () => {
  it("liest die Leiste aus der API; ältere Stände ohne die Felder sind an und leer", () => {
    const alt = formOf(zustand({ header: { search: "lupe", sticky: true } }));
    expect(alt.leisteAn).toBe(true);
    expect(alt.zusagen).toEqual([]);

    const neu = formOf(
      zustand({ header: { search: "aus", sticky: false, uspOn: false, usp: ["Versand frei"] } }),
    );
    expect(neu.leisteAn).toBe(false);
    expect(neu.zusagen).toEqual(["Versand frei"]);
  });

  it("schickt die Zusagen ohne Leerzeilen und ohne Leerzeichen am Rand", () => {
    const form = formOf(zustand({}));
    const body = bodyOf({ ...form, leisteAn: true, zusagen: ["  Versand frei ", "", "Rückgabe"] });
    expect(body.header).toEqual({
      search: "offen",
      sticky: false,
      uspOn: true,
      usp: ["Versand frei", "Rückgabe"],
    });
  });

  it("merkt sich das Symbol des Shops und schickt seine Id mit", () => {
    const form = formOf(zustand({ favicon: symbol }));
    expect(form.favicon).toEqual(symbol);
    expect(bodyOf(form).faviconImageId).toBe(symbol.id);
    expect(bodyOf({ ...form, favicon: null }).faviconImageId).toBeNull();
  });
});
