import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { API_TOKEN_PATTERN, generateApiToken, hashApiToken } from "./api-tokens.js";

describe("Form der API-Token (Sicherheit 5.2)", () => {
  it("shp_at_ + 43 Zeichen Base64url, jedes Mal anders", () => {
    const tokens = Array.from({ length: 50 }, () => generateApiToken());
    for (const t of tokens) {
      expect(t.token).toMatch(API_TOKEN_PATTERN);
      expect(Buffer.from(t.token.slice(7), "base64url")).toHaveLength(32);
      expect(t.prefix).toBe(t.token.slice(0, 11));
      expect(t.prefix).toMatch(/^shp_at_[A-Za-z0-9_-]{4}$/);
    }
    expect(new Set(tokens.map((t) => t.token)).size).toBe(50);
  });

  it("gespeichert wird nur der SHA-256-Wert des ganzen Tokens", () => {
    const t = generateApiToken();
    expect(t.hash).toEqual(createHash("sha256").update(t.token).digest());
    expect(hashApiToken(t.token)).toEqual(t.hash);
    expect(t.hash.toString("utf8")).not.toContain(t.token.slice(7, 20));
  });

  it("die gitleaks-Regel trifft jedes erzeugte Token", () => {
    // Gleiche Regel wie in .gitleaks.toml (tools/test/gitleaks.test.mjs prüft gitleaks selbst).
    const rule = /shp_at_[A-Za-z0-9_-]{32,}/;
    for (let i = 0; i < 20; i++) expect(generateApiToken().token).toMatch(rule);
  });

  it("andere Formen werden gar nicht erst nachgeschlagen", () => {
    for (const bad of [
      "",
      "shp_at_",
      `shp_at_${"a".repeat(42)}`,
      `shp_at_${"a".repeat(44)}`,
      `SHP_AT_${"a".repeat(43)}`,
      `shp_at_${"a".repeat(42)}=`,
    ])
      expect(API_TOKEN_PATTERN.test(bad), bad).toBe(false);
  });
});
