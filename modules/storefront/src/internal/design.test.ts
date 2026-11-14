import { describe, expect, it } from "vitest";
import {
  contrast,
  darker,
  DEFAULT_DESIGN,
  DEFAULT_HOME,
  imagesOf,
  isSafeLinkUrl,
  normalizeHex,
  readableWithWhite,
  readSettings,
  sameSettings,
} from "./design.js";

describe("Aussehen: Rechenregeln", () => {
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
      },
      tagline: "Tee mit Herz",
      footer: { text: "Mo–Fr", links: [{ label: "Kontakt", url: "mailto:a@b.example" }] },
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
    expect(alt.footer).toEqual({ text: "", links: [] });
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
