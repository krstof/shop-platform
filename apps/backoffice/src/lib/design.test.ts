import { describe, expect, it } from "vitest";
import {
  completeLinkUrl,
  contrastWithWhite,
  isSafeLinkUrl,
  darker,
  normalizeHex,
  PRESETS,
  readableWithWhite,
  storefrontUrl,
} from "./design.js";

describe("Shop-Editor: Farben", () => {
  it("alle fertigen Farben sind mit weißer Schrift gut lesbar", () => {
    for (const p of PRESETS) expect(readableWithWhite(p.color), p.name).toBe(true);
  });

  it("erkennt zu helle Farben", () => {
    expect(readableWithWhite("#ffd84d")).toBe(false);
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 5);
  });

  it("liest Hex auch ohne # und rechnet dunkler wie die API", () => {
    expect(normalizeHex("1F5F8B")).toBe("#1f5f8b");
    expect(normalizeHex("#12")).toBeUndefined();
    expect(darker("#3f6b4a")).toBe("#2f5038");
  });

  it("findet die Adresse des Shops", () => {
    expect(storefrontUrl("teeladen", { protocol: "https:", host: "admin.example.org" })).toBe(
      "https://shop.example.org/teeladen",
    );
  });
});

describe("Links im Fuß", () => {
  it("ergänzt E-Mail, Telefon und Webseite und prüft wie die API", () => {
    expect(completeLinkUrl("hallo@teeladen.example")).toBe("mailto:hallo@teeladen.example");
    expect(completeLinkUrl("+49 40 123456")).toBe("tel:+49 40 123456");
    expect(completeLinkUrl("www.teeladen.example")).toBe("https://www.teeladen.example");
    expect(completeLinkUrl("https://a.example")).toBe("https://a.example");
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(completeLinkUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(isSafeLinkUrl(completeLinkUrl("javascript:alert(1)"))).toBe(false);
    expect(completeLinkUrl("www.teeladen.example:8080")).toBe("https://www.teeladen.example:8080");
    expect(isSafeLinkUrl("mailto:a@b.example")).toBe(true);
  });
});

describe("Editor: Hintergrund, Schriften, Netzwerke", () => {
  it("prüft Hintergründe, sucht Schriften, ergänzt Profile", async () => {
    const d = await import("./design.js");
    expect(d.readableBackground("#ffffff")).toBe(true);
    expect(d.readableBackground("#333333")).toBe(false);
    expect(d.BACKGROUNDS.every((b) => d.readableBackground(b.color))).toBe(true);
    expect(d.mix("#ffffff", "#000000", 0.5)).toBe("#808080");
    const all = await d.loadFontCatalog();
    expect(all.length).toBeGreaterThan(1000);
    expect(d.searchFonts(all, "lor")[0]?.name).toBe("Lora");
    expect(d.SUGGESTED_FONTS.every((f) => all.some((a) => a.id === f.id && a.name === f.name))).toBe(true);
    expect(d.webFontCssUrl([{ id: "lora", name: "Lora", category: "serif" }])).toContain("family=lora:400");
    expect(d.completeSocialUrl("instagram.com/x")).toBe("https://instagram.com/x");
    expect(d.isSocialUrl("javascript:alert(1)")).toBe(false);
  });
});
