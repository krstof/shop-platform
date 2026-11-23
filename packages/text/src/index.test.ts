import { describe, expect, it } from "vitest";
import {
  alsLink,
  alsListe,
  alsUeberschrift,
  formatText,
  isSafeTextUrl,
  plainText,
  umschliessen,
} from "./index.js";

describe("Formatierung in Textfeldern", () => {
  it("macht Absätze, fett und kursiv", () => {
    expect(formatText("Hallo **Welt**")).toBe("<p>Hallo <strong>Welt</strong></p>");
    expect(formatText("Ein *Hinweis*")).toBe("<p>Ein <em>Hinweis</em></p>");
    expect(formatText("Eins\n\nZwei")).toBe("<p>Eins</p><p>Zwei</p>");
    // Zeilenumbruch im Absatz bleibt ein Umbruch.
    expect(formatText("Eins\nZwei")).toBe("<p>Eins<br />Zwei</p>");
  });

  it("macht Aufzählungen und nummerierte Listen", () => {
    expect(formatText("- Tee\n- Kaffee")).toBe("<ul><li>Tee</li><li>Kaffee</li></ul>");
    expect(formatText("1. Erst\n2. Dann")).toBe("<ol><li>Erst</li><li>Dann</li></ol>");
    expect(formatText("Text\n\n- Punkt")).toBe("<p>Text</p><ul><li>Punkt</li></ul>");
  });

  it("macht Überschriften (Paket P5)", () => {
    expect(formatText("## Zubereitung")).toBe("<h3>Zubereitung</h3>");
    expect(formatText("## Zubereitung\nMit 80 Grad")).toBe("<h3>Zubereitung</h3><p>Mit 80 Grad</p>");
    expect(formatText("## **Wichtig**")).toBe("<h3><strong>Wichtig</strong></h3>");
    // Ohne Leerzeichen ist es keine Überschrift, sondern Text.
    expect(formatText("#1 im Shop")).toBe("<p>#1 im Shop</p>");
    expect(plainText("## Zubereitung")).toBe("Zubereitung");
  });

  it("macht eine Zeile zur Überschrift und wieder zurück", () => {
    expect(alsUeberschrift("Zubereitung", 0, 11).text).toBe("## Zubereitung");
    expect(alsUeberschrift("## Zubereitung", 3, 5).text).toBe("Zubereitung");
    expect(alsUeberschrift("Eins\nZwei", 0, 9).text).toBe("## Eins\n## Zwei");
  });

  it("macht Links nur zu erlaubten Adressen und markiert fremde Seiten", () => {
    expect(formatText("[Hilfe](/seite/hilfe)")).toBe('<p><a href="/seite/hilfe">Hilfe</a></p>');
    expect(formatText("[Mail](mailto:a@b.example)")).toBe('<p><a href="mailto:a@b.example">Mail</a></p>');
    expect(formatText("[Extern](https://example.com)")).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">Extern</a></p>',
    );
    // Gefährliche Adresse: bleibt Text, wird nie ein Link.
    expect(formatText("[Klick](javascript:alert(1))")).toBe("<p>[Klick](javascript:alert(1))</p>");
    expect(isSafeTextUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeTextUrl("//example.com")).toBe(false);
  });

  it("lässt fremdes HTML nie durch", () => {
    expect(formatText("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(formatText('<img src=x onerror="böse">')).toBe(
      "<p>&lt;img src=x onerror=&quot;böse&quot;&gt;</p>",
    );
    expect(formatText("**<b>fett</b>**")).toBe("<p><strong>&lt;b&gt;fett&lt;/b&gt;</strong></p>");
  });

  it("gibt den reinen Text ohne Auszeichnung zurück", () => {
    expect(plainText("Hallo **Welt** und [Link](/a)")).toBe("Hallo Welt und Link");
    expect(plainText("- Tee\n- Kaffee")).toBe("Tee\nKaffee");
  });

  it("legt eine Auszeichnung um die Auswahl und nimmt sie wieder weg", () => {
    expect(umschliessen("Hallo Welt", 6, 10, "**")).toEqual({
      text: "Hallo **Welt**",
      start: 8,
      ende: 12,
    });
    // Noch einmal auf denselben Teil: die Auszeichnung verschwindet.
    expect(umschliessen("Hallo **Welt**", 8, 12, "**")).toEqual({
      text: "Hallo Welt",
      start: 6,
      ende: 10,
    });
    expect(umschliessen("Hallo **Welt**", 6, 14, "**")).toEqual({
      text: "Hallo Welt",
      start: 6,
      ende: 10,
    });
  });

  it("macht aus Zeilen eine Liste und wieder Zeilen", () => {
    const liste = alsListe("Tee\nKaffee", 0, 10, false);
    expect(liste.text).toBe("- Tee\n- Kaffee");
    expect(alsListe(liste.text, 0, liste.text.length, false).text).toBe("Tee\nKaffee");
    expect(alsListe("Tee\nKaffee", 0, 10, true).text).toBe("1. Tee\n2. Kaffee");
  });

  it("setzt einen Link um die Auswahl", () => {
    expect(alsLink("Mehr dazu hier", 10, 14, "/seite/hilfe")).toEqual({
      text: "Mehr dazu [hier](/seite/hilfe)",
      start: 11,
      ende: 15,
    });
  });
});
