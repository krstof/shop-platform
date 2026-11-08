import { describe, expect, it } from "vitest";
import {
  hashResetCode,
  newResetCode,
  PASSWORD_RESET_MAILS_PER_WINDOW,
  PASSWORD_RESET_WINDOW_SECONDS,
  passwordResetMail,
  RESET_CODE_PATTERN,
  ResetMailLimiter,
  resetLink,
} from "./password-reset.js";

describe("Code für „Passwort vergessen“", () => {
  it("hat 32 Byte Zufall als 43 Zeichen Base64url und ist jedes Mal anders", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newResetCode().code));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(RESET_CODE_PATTERN);
  });

  it("speichert nur den SHA-256-Wert (32 Byte), nie den Code", () => {
    const { code, hash } = newResetCode();
    expect(hash).toHaveLength(32);
    expect(hash.equals(hashResetCode(code))).toBe(true);
    expect(hash.toString("base64url")).not.toBe(code);
  });

  it("steht im Link hinter #, damit er nie an einen Server geht", () => {
    const link = resetLink("https://admin.localhost/irgendwas?x=1", "abc");
    expect(link).toBe("https://admin.localhost/passwort-neu#code=abc");
    const url = new URL(link);
    expect(url.search).toBe("");
    expect(url.hash).toBe("#code=abc");
  });
});

describe("E-Mail „Passwort zurücksetzen“", () => {
  const link = "https://admin.localhost/passwort-neu#code=xyz";

  it("ist auf Deutsch, nennt Link, Frist und was tun, wenn man es nicht war", () => {
    const mail = passwordResetMail({ to: "a@b.example", name: "Ida", locale: "de", link });
    expect(mail.subject).toBe("Passwort zurücksetzen");
    expect(mail.text).toContain("Hallo Ida,");
    expect(mail.text).toContain(link);
    expect(mail.text).toContain("30 Minuten");
    expect(mail.text).toContain("ignoriere");
  });

  it("gibt es auf Englisch für Konten mit Sprache en", () => {
    const mail = passwordResetMail({ to: "a@b.example", name: null, locale: "en", link });
    expect(mail.subject).toBe("Reset your password");
    expect(mail.text.startsWith("Hello,\n")).toBe(true);
    expect(mail.text).toContain("30 minutes");
  });

  it("nimmt Zeilenumbrüche aus dem Namen und kürzt ihn", () => {
    const mail = passwordResetMail({
      to: "a@b.example",
      name: `Ida\r\nBcc: x@y.example${"z".repeat(300)}`,
      locale: "de",
      link,
    });
    const firstLine = mail.text.split("\n")[0] ?? "";
    expect(firstLine).toContain("Ida Bcc: x@y.example");
    expect(firstLine.length).toBeLessThan(120);
  });
});

describe("Zählung der E-Mails je Konto", () => {
  it("lässt 3 E-Mails in 15 Minuten durch, danach erst wieder, wenn die älteste aus dem Fenster ist", () => {
    let t = 0;
    const limiter = new ResetMailLimiter(() => t);
    for (let i = 0; i < PASSWORD_RESET_MAILS_PER_WINDOW; i++) {
      expect(limiter.take("konto-1")).toBe(true);
      t += 60_000;
    }
    expect(limiter.take("konto-1")).toBe(false);
    // Ein anderes Konto ist davon unberührt.
    expect(limiter.take("konto-2")).toBe(true);
    t = PASSWORD_RESET_WINDOW_SECONDS * 1000 - 1;
    expect(limiter.take("konto-1")).toBe(false);
    t = PASSWORD_RESET_WINDOW_SECONDS * 1000;
    expect(limiter.take("konto-1")).toBe(true);
  });

  it("merkt sich höchstens maxKeys Konten und vergisst die ältesten zuerst", () => {
    const limiter = new ResetMailLimiter(() => 0, 1, 900, 2);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
    expect(limiter.take("c")).toBe(true); // verdrängt a
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("c")).toBe(false);
  });
});
