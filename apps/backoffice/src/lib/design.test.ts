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
