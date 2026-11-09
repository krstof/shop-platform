import { describe, expect, it } from "vitest";
import {
  invitationIdentifier,
  invitationLink,
  invitationMail,
  INVITATION_SECONDS,
  parseInvitationIdentifier,
} from "./invitations.js";

const T = "019a6b2c-0000-7000-8000-000000000001";
const U = "019a6b2c-0000-7000-8000-000000000002";

describe("Einladungen: Bausteine (E6 Teil 7)", () => {
  it("Kennung <Shop>:<Konto> hin und zurück; alles andere ist ungültig", () => {
    expect(parseInvitationIdentifier(invitationIdentifier(T, U))).toEqual({ tenantId: T, userId: U });
    for (const bad of ["", T, `${T}:${U}:x`, `${T}:nicht-uuid`, ` ${T}:${U}`, `${T.toUpperCase()}:${U}`])
      expect(parseInvitationIdentifier(bad)).toBeUndefined();
  });

  it("Link: nur der Ursprung der Backoffice-Adresse, Code nach #", () => {
    expect(invitationLink("https://admin.localhost/irgendwo?x=1", "abc")).toBe(
      "https://admin.localhost/einladung#code=abc",
    );
  });

  it("gilt 7 Tage", () => {
    expect(INVITATION_SECONDS).toBe(604_800);
  });

  it("Shopname und Name kommen nie mit Zeilenumbruch in Betreff oder Text", () => {
    const mail = invitationMail({
      to: "ida@teeladen.example",
      name: "Ida\r\nBcc: alle@example.com",
      shopName: "Tee\nBcc: boese@example.com",
      locale: "de",
      link: "https://admin.localhost/einladung#code=abc",
      hasPassword: false,
    });
    expect(mail.subject).toBe("Einladung zum Shop „Tee Bcc: boese@example.com“");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text.split("\n")[0]).toBe("Hallo Ida Bcc: alle@example.com,");
    expect(mail.text).toContain("wählst ein Passwort");
    expect(mail.text).toContain("7 Tage");
  });

  it("Englisch, bestehendes Konto, ohne Shopname", () => {
    const mail = invitationMail({
      to: "ida@teeladen.example",
      name: null,
      shopName: undefined,
      locale: "en",
      link: "https://admin.localhost/einladung#code=abc",
      hasPassword: true,
    });
    expect(mail.subject).toBe("Invitation to a shop");
    expect(mail.text).toContain("You keep your password.");
    expect(mail.text.startsWith("Hello,")).toBe(true);
  });
});
