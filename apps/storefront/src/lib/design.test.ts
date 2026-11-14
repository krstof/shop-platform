import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN,
  DEFAULT_HOME,
  designCss,
  designVersion,
  isExternal,
  mapUrls,
  safeLink,
  startseitenBausteine,
  videoEmbedUrl,
} from "./design.js";

describe("Aussehen in der Storefront", () => {
  it("schreibt Farbe und Schrift als CSS-Variablen", () => {
    const css = designCss({
      ...DEFAULT_DESIGN,
      accentColor: "#1F5F8B",
      accentDarkColor: "#174768",
      font: "modern",
    });
    expect(css).toContain("--akzent: #1f5f8b;");
    expect(css).toContain("--akzent-dunkel: #174768;");
    expect(css).toContain("--schrift-titel: system-ui");
  });

  it("lässt nichts Fremdes ins CSS", () => {
    const css = designCss({
      ...DEFAULT_DESIGN,
      accentColor: "red;} body{display:none",
      accentDarkColor: "url(x)",
      font: "comic" as never,
    });
    expect(css).toContain("--akzent: #3f6b4a;");
    expect(css).toContain("--akzent-dunkel: #2f5038;");
    expect(css).toContain("--schrift-titel: Georgia");
    expect(css).not.toContain("display");
  });

  it("ändert die Version, wenn sich das Aussehen ändert", () => {
    expect(designVersion(DEFAULT_DESIGN)).toBe(designVersion({ ...DEFAULT_DESIGN }));
    expect(designVersion(DEFAULT_DESIGN)).not.toBe(designVersion({ ...DEFAULT_DESIGN, font: "modern" }));
  });
});

describe("Links im Fuß (Shop-Editor Teil 3)", () => {
  it("lässt nur https/http, mailto und tel durch", () => {
    expect(safeLink("https://teeladen.example/kontakt")).toBe("https://teeladen.example/kontakt");
    expect(safeLink("mailto:hallo@teeladen.example")).toBe("mailto:hallo@teeladen.example");
    expect(safeLink("tel:+49 40 123456")).toBe("tel:+49 40 123456");
    expect(safeLink("javascript:alert(1)")).toBeUndefined();
    expect(safeLink("data:text/html,<b>x</b>")).toBeUndefined();
    expect(safeLink('https://x.example/"><script>')).toBeUndefined();
    expect(safeLink("//evil.example")).toBeUndefined();
    expect(isExternal("https://a.example")).toBe(true);
    expect(isExternal("mailto:a@b.example")).toBe(false);
  });

  it("baut Video- und Kartenadressen nur aus geprüften Teilen", () => {
    expect(videoEmbedUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoEmbedUrl("vimeo", "76979871")).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(videoEmbedUrl("youtube", '"><script>')).toBeUndefined();
    expect(mapUrls("Teeweg 1 & Co, Hamburg").embed).toBe(
      "https://www.google.com/maps?q=Teeweg%201%20%26%20Co%2C%20Hamburg&output=embed",
    );
  });

  it("leitet ohne Bausteine die alte Reihenfolge ab", () => {
    expect(startseitenBausteine({ ...DEFAULT_HOME, showNew: false }).map((b) => b.type)).toEqual([
      "hero",
      "featured",
      "categories",
    ]);
    expect(startseitenBausteine({ ...DEFAULT_HOME, blocks: [] })).toEqual([]);
  });
});
