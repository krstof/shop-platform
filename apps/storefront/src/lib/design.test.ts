import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designCss, designVersion } from "./design.js";

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
