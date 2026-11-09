// Einladungen von Mitarbeitern (E6 Teil 7, SIC-03, Sicherheit 5.3, ADR-014). Reine Bausteine;
// Datenbank und Ablauf stecken in identity-service.ts (Codes, Konten: shop_auth) und members.ts
// (Mitgliedschaften: shop_app).
//
// - Code wie bei „Passwort vergessen“: 32 Byte Zufall als Base64url, in identity.verification nur der
//   SHA-256-Wert, Zweck `invitation`, identifier `<Shop-ID>:<Konto-ID>`, 7 Tage gültig, einmal gültig,
//   eine neue Einladung ersetzt den alten Code.
// - Der Link führt ins Backoffice (`/einladung#code=…`); der Teil nach `#` geht nie an einen Server.
import type { Locale } from "@shop/kernel";
import type { OutgoingMail } from "./password-reset.js";

/** Gültigkeit einer Einladung: 7 Tage. */
export const INVITATION_SECONDS = 7 * 24 * 60 * 60;
/** Seite im Backoffice, die den Code aus dem Link liest (kommt mit E18). */
export const INVITATION_PATH = "/einladung";
/** Höchstens so viele offene Einladungen je Shop (gegen Missbrauch als E-Mail-Schleuder). */
export const MAX_PENDING_INVITATIONS_PER_SHOP = 20;
/** Höchstens so viele Einladungs-E-Mails an dieselbe Person für denselben Shop in 15 Minuten. */
export const INVITATION_MAILS_PER_WINDOW = 3;

export function invitationIdentifier(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IDENTIFIER = new RegExp(`^(${UUID}):(${UUID})$`);

/** Gegenstück zu invitationIdentifier. Alles andere: `undefined`. */
export function parseInvitationIdentifier(
  identifier: string,
): { readonly tenantId: string; readonly userId: string } | undefined {
  const m = IDENTIFIER.exec(identifier);
  return m?.[1] === undefined || m[2] === undefined ? undefined : { tenantId: m[1], userId: m[2] };
}

export function invitationLink(baseUrl: string, code: string): string {
  return `${new URL(baseUrl).origin}${INVITATION_PATH}#code=${code}`;
}

/** Eine Zeile Text ohne Zeilenumbrüche, gekürzt. Namen kommen aus der Datenbank. */
function oneLine(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .trim()
    .slice(0, max);
}

export function invitationMail(input: {
  readonly to: string;
  readonly name: string | null;
  readonly shopName: string | undefined;
  readonly locale: Locale;
  readonly link: string;
  /** Das Konto hat schon ein Passwort (dann keins wählen). */
  readonly hasPassword: boolean;
}): OutgoingMail {
  const name = oneLine(input.name, 100);
  const shop = oneLine(input.shopName, 100);
  const days = INVITATION_SECONDS / 86_400;
  if (input.locale === "en") {
    const where = shop === "" ? "a shop" : `the shop "${shop}"`;
    return {
      to: input.to,
      subject: shop === "" ? "Invitation to a shop" : `Invitation to the shop "${shop}"`,
      text:
        `Hello${name === "" ? "" : ` ${name}`},\n\n` +
        `you have been invited to work in ${where} on the shop platform. ` +
        (input.hasPassword
          ? "Use this link to accept. You keep your password. "
          : "Use this link to accept and choose a password. ") +
        `It works once and for ${days} days:\n\n` +
        `${input.link}\n\n` +
        "Not expecting this? Then just ignore this email. Nothing happens without you.\n",
    };
  }
  const where = shop === "" ? "in einem Shop" : `im Shop „${shop}“`;
  return {
    to: input.to,
    subject: shop === "" ? "Einladung zu einem Shop" : `Einladung zum Shop „${shop}“`,
    text:
      `Hallo${name === "" ? "" : ` ${name}`},\n\n` +
      `du wurdest eingeladen, auf der Shop-Plattform ${where} mitzuarbeiten. ` +
      (input.hasPassword
        ? "Über diesen Link nimmst du die Einladung an. Dein Passwort bleibt, wie es ist. "
        : "Über diesen Link nimmst du die Einladung an und wählst ein Passwort. ") +
      `Er gilt einmal und ${days} Tage lang:\n\n` +
      `${input.link}\n\n` +
      "Hast du damit nicht gerechnet? Dann ignoriere diese E-Mail einfach. Ohne dich passiert nichts.\n",
  };
}
