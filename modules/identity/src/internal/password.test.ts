import { describe, expect, it } from "vitest";
import {
  ARGON2_OPTIONS,
  checkNewPassword,
  commonPasswordCount,
  hashPassword,
  verifyPassword,
} from "./password.js";

describe("Passwortregeln nach NIST (Sicherheit 5.2)", () => {
  it("verlangt 12 bis 128 Zeichen und zählt Zeichen, nicht Bytes", () => {
    expect(checkNewPassword("a".repeat(11) + "Z")).toBeUndefined();
    expect(checkNewPassword("kurz-genug?")).toBe("too_short");
    expect(checkNewPassword("ä".repeat(12))).toBeUndefined();
    expect(checkNewPassword("🐱".repeat(12))).toBeUndefined();
    expect(checkNewPassword("x".repeat(128))).toBeUndefined();
    expect(checkNewPassword("x".repeat(129))).toBe("too_long");
  });

  it("erzwingt keine Zeichenklassen", () => {
    expect(checkNewPassword("nur kleine buchstaben hier")).toBeUndefined();
  });

  it("kennt eine Liste häufiger Passwörter und vergleicht ohne Groß- und Kleinschreibung", () => {
    expect(commonPasswordCount()).toBeGreaterThan(40_000);
    expect(checkNewPassword("password1234")).toBe("common");
    expect(checkNewPassword("PASSWORD1234")).toBe("common");
    expect(checkNewPassword("qwertyuiopasdfghjkl")).toBe("common");
  });

  it("verbietet die E-Mail-Adresse im Passwort", () => {
    expect(checkNewPassword("mein-teeladen-2026!", "teeladen@example.de")).toBe("contains_email");
  });
});

describe("Argon2id (Sicherheit 5.2, Anforderungen 6.4)", () => {
  it("nutzt mindestens 19 MiB, 2 Durchläufe, Parallelität 1", () => {
    expect(ARGON2_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(ARGON2_OPTIONS.timeCost).toBeGreaterThanOrEqual(2);
    expect(ARGON2_OPTIONS.parallelism).toBe(1);
  });

  it("erzeugt jedes Mal einen anderen Hash und prüft ihn richtig", async () => {
    const a = await hashPassword("Kaffeebohnen-im-Februar-42");
    const b = await hashPassword("Kaffeebohnen-im-Februar-42");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(a, "Kaffeebohnen-im-Februar-42")).toBe(true);
    expect(await verifyPassword(a, "Kaffeebohnen-im-Februar-43")).toBe(false);
  });

  it("behandelt verschiedene Unicode-Schreibweisen gleich (NFKC)", async () => {
    const h = await hashPassword("Grüner-Tee-mit-Minze");
    expect(await verifyPassword(h, "Grüner-Tee-mit-Minze")).toBe(true);
  });

  it("gibt bei fremden oder kaputten Hashes false zurück statt eines Fehlers", async () => {
    expect(await verifyPassword("", "x")).toBe(false);
    expect(await verifyPassword("scrypt$abc", "x")).toBe(false);
    expect(await verifyPassword("$argon2id$kaputt", "x")).toBe(false);
  });
});
