import { describe, expect, it } from "vitest";
import { pickLocale } from "./locale.js";

describe("pickLocale (Accept-Language)", () => {
  it.each([
    [undefined, "de"],
    ["", "de"],
    ["en", "en"],
    ["en-US,en;q=0.9", "en"],
    ["de-DE,de;q=0.9,en;q=0.8", "de"],
    ["fr-FR,fr;q=0.9,en;q=0.5", "en"],
    ["fr", "de"],
    ["*", "de"],
    ["en;q=0.3, de;q=0.7", "de"],
    ["en;q=0.9, de;q=0.9", "en"],
    ["en;q=0", "de"],
    ["EN-gb", "en"],
    ["en;q=kaputt", "en"],
    [["fr", "en"], "en"],
  ] as const)("%j → %s", (header, expected) => {
    expect(pickLocale(header)).toBe(expected);
  });

  it("zerlegt überlange Kopfzeilen nicht, sondern nimmt Deutsch", () => {
    expect(pickLocale("en," + "x".repeat(400))).toBe("de");
  });
});
