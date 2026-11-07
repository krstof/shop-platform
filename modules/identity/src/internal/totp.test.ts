import { describe, expect, it } from "vitest";
import {
  base32Encode,
  newBackupCodes,
  otpauthUri,
  totpCode,
  totpStep,
  useBackupCode,
  verifyTotp,
} from "./totp.js";

// Prüfwerte aus RFC 6238, Anhang B (SHA-1, Geheimnis „12345678901234567890“, 8 Ziffern).
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("Prüfwert für T=%i", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(expected);
    // 6 Ziffern sind die letzten 6 der 8-stelligen Werte.
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(expected.slice(2));
  });

  it("Base32 nach RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("nimmt einen Zeitschritt vorher und nachher an, nicht mehr", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, undefined)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, undefined)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, undefined)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now, undefined)).toBeUndefined();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now, undefined)).toBeUndefined();
  });

  it("derselbe Code gilt nur einmal, ältere Codes danach auch nicht", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeUndefined();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step)).toBeUndefined();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
  });

  it("verträgt Leerzeichen, lehnt alles andere ab", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, totpStep(now));
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now, undefined)).toBeDefined();
    for (const bad of ["", "12345", "1234567", "abcdef", `${code}\n0`])
      expect(verifyTotp(RFC_SECRET, bad, now, undefined)).toBeUndefined();
  });

  it("otpauth-Adresse für die Authenticator-App", () => {
    const uri = new URL(otpauthUri(RFC_SECRET, "betreiber@shop.example", "Shop-Plattform"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.href.startsWith("otpauth://totp/Shop-Plattform:betreiber%40shop.example?")).toBe(true);
    expect(uri.searchParams.get("secret")).toBe(base32Encode(RFC_SECRET));
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});

describe("Ersatzcodes", () => {
  it("10 verschiedene Codes im Format xxxxx-xxxxx", () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });

  it("ein Code gilt einmal, Groß- und Kleinschreibung und Bindestrich egal", () => {
    const codes = ["abcde-fghjk", "mnpqr-stuvw"];
    const rest = useBackupCode(codes, "ABCDEFGHJK");
    expect(rest).toEqual(["mnpqr-stuvw"]);
    expect(useBackupCode(rest ?? [], "abcde-fghjk")).toBeUndefined();
    expect(useBackupCode(codes, "abcde-fghjx")).toBeUndefined();
    expect(useBackupCode(codes, "")).toBeUndefined();
    expect(useBackupCode(codes, "x".repeat(500))).toBeUndefined();
  });
});
