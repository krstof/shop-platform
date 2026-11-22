import { describe, expect, it } from "vitest";
import {
  contrast,
  darker,
  DEFAULT_DESIGN,
  DEFAULT_HEADER,
  DEFAULT_HOME,
  imagesOf,
  isSafeLinkUrl,
  normalizeHex,
  readableWithWhite,
  readSettings,
  sameSettings,
} from "./design.js";

describe("Aussehen: Rechenregeln", () => {
  it("liest die Kopfzeile und macht aus Unsinn den Standard", () => {
    // Alte Shops haben das Feld nicht: offenes Suchfeld, Kopf scrollt mit.
    expect(readSettings({}).header).toEqual(DEFAULT_HEADER);
    // Leiste oben (22.11.2026): ältere Stände ohne die Felder bekommen „an, ohne eigene Zusagen“.
    expect(readSettings({ header: { search: "lupe", sticky: true } }).header).toEqual({
      search: "lupe",
      sticky: true,
      uspOn: true,
      usp: [],
    });
    expect(
      readSettings({ header: { search: "aus", sticky: false, uspOn: false, usp: ["Versand frei"] } }).header,
    ).toEqual({ search: "aus", sticky: false, uspOn: false, usp: ["Versand frei"] });
    // Zu viele oder falsche Zusagen: die Liste fällt auf leer zurück.
    expect(readSettings({ header: { search: "offen", sticky: false, usp: [1, 2] } }).header.usp).toEqual([]);
    expect(readSettings({ header: { search: "blinkend", sticky: "ja" } }).header).toEqual(DEFAULT_HEADER);
  });

  it("rechnet Kontraste wie WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Standardfarbe des Shops: gut lesbar mit weißer Schrift.
    expect(readableWithWhite("#3f6b4a")).toBe(true);
    // Hellgelb und Hellgrau: zu hell für weiße Schrift.
    expect(readableWithWhite("#ffd84d")).toBe(false);
    expect(readableWithWhite("#999999")).toBe(false);
    // #767676 ist die bekannte Grenze für 4,5 : 1 auf Weiß.
    expect(readableWithWhite("#767676")).toBe(true);
  });

  it("macht Farben dunkler und schreibt Hex klein", () => {
    expect(darker("#ffffff")).toBe("#bfbfbf");
    expect(darker("#3f6b4a")).toBe("#2f5038");
    expect(normalizeHex(" #AbC123 ")).toBe("#abc123");
    expect(normalizeHex("#abc")).toBeUndefined();
    expect(normalizeHex("red")).toBeUndefined();
  });

  it("liest gespeichertes JSON robust", () => {
    expect(readSettings({})).toEqual(DEFAULT_DESIGN);
    expect(readSettings(null)).toEqual(DEFAULT_DESIGN);
    // Alte Shops (vor Teil 2) haben kein home-Feld: der Standard wird ergänzt.
    expect(readSettings({ accentColor: "kaputt", font: "comic", logoImageId: 5 })).toEqual(DEFAULT_DESIGN);
    expect(readSettings({ accentColor: "#1f5f8b", font: "modern", logoImageId: null }).home).toEqual(
      DEFAULT_HOME,
    );
    const s = {
      accentColor: "#1f5f8b",
      font: "modern",
      logoImageId: "0190a3c4-0000-7000-8000-000000000001",
      home: {
        heroImageId: "0190a3c4-0000-7000-8000-000000000002",
        heroTitle: "Hallo",
        heroText: "Text",
        featuredProductIds: ["0190a3c4-0000-7000-8000-000000000003"],
        showCategories: false,
        showNew: false,
        blocks: [{ id: "b1", type: "text", heading: "Hallo", text: "Welt" }],
      },
      tagline: "Tee mit Herz",
      footer: {
        text: "Mo–Fr",
        links: [{ label: "Kontakt", url: "mailto:a@b.example" }],
        social: { instagram: "https://instagram.com/teeladen" },
      },
      backgroundColor: "#ffffff",
      headingFont: { id: "lora", name: "Lora", category: "serif" },
      bodyFont: null,
      template: "boutique",
      faviconImageId: "0190a3c4-0000-7000-8000-000000000004",
      header: { search: "lupe", sticky: true, uspOn: true, usp: ["Versand ab 29 €"] },
      pages: [
        {
          id: "p1",
          title: "Über uns",
          slug: "ueber-uns",
          inFooter: true,
          blocks: [{ id: "b2", type: "map", address: "Teeweg 1" }],
        },
      ],
    };
    expect(readSettings(s)).toEqual(s);
    expect(sameSettings(readSettings(s), readSettings(s))).toBe(true);
    expect(sameSettings(readSettings(s), DEFAULT_DESIGN)).toBe(false);
    // Ältere Stände ohne showNew: Standard „zeigen“.
    const older: Record<string, unknown> = { ...s.home };
    delete older["showNew"];
    expect(readSettings({ ...s, home: older }).home.showNew).toBe(true);
  });

  it("liest kaputte Startseiten-Felder zum Standard, Reihenfolge zählt für Gleichheit", () => {
    // Zu lange Texte, zu viele Produkte, falsche Typen: jedes Feld fällt einzeln auf den Standard.
    const home = readSettings({
      accentColor: "#1f5f8b",
      font: "modern",
      logoImageId: null,
      home: {
        heroImageId: "nicht-uuid",
        heroTitle: "x".repeat(200),
        heroText: 42,
        featuredProductIds: "keine-liste",
        showCategories: "ja",
      },
    }).home;
    expect(home).toEqual(DEFAULT_HOME);

    const base = readSettings({ accentColor: "#1f5f8b", font: "modern", logoImageId: null });
    const id1 = "0190a3c4-0000-7000-8000-000000000001";
    const id2 = "0190a3c4-0000-7000-8000-000000000002";
    const a = { ...base, home: { ...base.home, featuredProductIds: [id1, id2] } };
    const b = { ...base, home: { ...base.home, featuredProductIds: [id2, id1] } };
    expect(sameSettings(a, a)).toBe(true);
    expect(sameSettings(a, b)).toBe(false); // andere Reihenfolge = andere Einstellung
  });

  it("imagesOf sammelt Logo und Startseitenbild", () => {
    expect(imagesOf(DEFAULT_DESIGN)).toEqual([]);
    const id1 = "0190a3c4-0000-7000-8000-000000000001";
    const id2 = "0190a3c4-0000-7000-8000-000000000002";
    const s = readSettings({
      accentColor: "#1f5f8b",
      font: "modern",
      logoImageId: id1,
      home: { heroImageId: id2, heroTitle: "", heroText: "", featuredProductIds: [], showCategories: true },
    });
    expect(imagesOf(s).sort()).toEqual([id1, id2].sort());
  });

  it("Kopf- und Fußzeile: fehlt bei alten Shops, gefährliche Links fallen weg", () => {
    const alt = readSettings({ accentColor: "#1f5f8b", font: "modern", logoImageId: null });
    expect(alt.tagline).toBe("");
    expect(alt.footer).toEqual({ text: "", links: [], social: {} });
    // Zu dunkler Hintergrund und kaputte Schrift fallen auf den Standard zurück, fremde Netzwerke weg.
    const dunkel = readSettings({
      backgroundColor: "#111111",
      headingFont: { id: "x y", name: "<b>", category: "serif" },
      footer: { text: "", links: [], social: { instagram: "javascript:1", myspace: "https://x.example" } },
    });
    expect(dunkel.backgroundColor).toBe("#fbf8f3");
    expect(dunkel.headingFont).toBeNull();
    expect(dunkel.footer.social).toEqual({});
    const boese = readSettings({
      accentColor: "#1f5f8b",
      font: "modern",
      logoImageId: null,
      footer: { text: "x", links: [{ label: "Klick", url: "javascript:alert(1)" }] },
    });
    expect(boese.footer.links).toEqual([]);
    expect(isSafeLinkUrl("https://a.example/kontakt")).toBe(true);
    expect(isSafeLinkUrl("tel:+49 40 123")).toBe(true);
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,x")).toBe(false);
    expect(isSafeLinkUrl('https://a.example/"><script>')).toBe(false);
  });
});
