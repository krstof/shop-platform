// „Passwort vergessen“ (E6 Teil 6, PLA-04, Sicherheit 5.2, ADR-013).
//
// - Einmalcode: 32 Byte Zufall als Base64url (43 Zeichen). In identity.verification steht nur der
//   SHA-256-Wert, Zweck `password_reset`, Ablauf nach 30 Minuten, je Konto höchstens ein gültiger
//   Code (ein neuer ersetzt den alten). Er gilt genau einmal.
// - Die Antwort auf „Passwort vergessen“ ist immer gleich und kommt sofort; Nachsehen, Code anlegen
//   und E-Mail versenden laufen danach im Hintergrund. So verraten weder Inhalt noch Dauer der
//   Antwort, ob es die E-Mail-Adresse gibt.
// - Gegen E-Mail-Bomben: höchstens 3 E-Mails je Konto in 15 Minuten, darüber hinaus still nichts.
//   Die Anfragebremse der Auth-API (5 je Minute und Netz) gilt zusätzlich.
// - Der Code steht im Link nach `#`: Der Teil nach `#` geht nie an einen Server, landet also weder
//   in Protokollen noch in der Kopfzeile Referer.
// - Neues Passwort setzen meldet nicht an. Alle Sitzungen des Kontos werden beendet; wer
//   Zwei-Faktor hat, braucht beim nächsten Anmelden wieder den Code (ADR-011).
// Hier stehen nur die reinen Bausteine; Datenbank und Ablauf stecken in identity-service.ts.
import { createHash, randomBytes } from "node:crypto";
import type { Locale } from "@shop/kernel";

/** Gültigkeit eines Codes (Sicherheit 5.2: 30 Minuten). */
export const PASSWORD_RESET_SECONDS = 30 * 60;
/** Höchstens so viele E-Mails je Konto im Zeitfenster. */
export const PASSWORD_RESET_MAILS_PER_WINDOW = 3;
export const PASSWORD_RESET_WINDOW_SECONDS = 15 * 60;
/** Pfad der Seite im Backoffice, die den Code aus dem Link liest (kommt mit E18). */
export const PASSWORD_RESET_PATH = "/passwort-neu";
/** Form eines Codes: 43 Zeichen Base64url (32 Byte). */
export const RESET_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newResetCode(): { readonly code: string; readonly hash: Buffer } {
  const code = randomBytes(32).toString("base64url");
  return { code, hash: hashResetCode(code) };
}

export function hashResetCode(code: string): Buffer {
  return createHash("sha256").update(code, "utf8").digest();
}

/** Link für die E-Mail: Backoffice-Adresse, fester Pfad, Code nach `#`. */
export function resetLink(baseUrl: string, code: string): string {
  return `${new URL(baseUrl).origin}${PASSWORD_RESET_PATH}#code=${code}`;
}

/** Eine E-Mail, wie das Modul sie verschickt. Nur Text, keine Anhänge, kein HTML. */
export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Versand von E-Mails. Setzt apps/api zusammen (heute direkt an Mailpit, ab E16 über das Modul
 * notifications). Darf werfen; der Fehler wird protokolliert, ohne Empfänger und ohne Inhalt.
 */
export interface MailSender {
  send(mail: OutgoingMail): Promise<void>;
}

export function passwordResetMail(input: {
  readonly to: string;
  readonly name: string | null;
  readonly locale: Locale;
  readonly link: string;
}): OutgoingMail {
  // Der Name kommt aus der Datenbank und steht nur im Text, nie in einer Kopfzeile.
  const name = (input.name ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100);
  const minutes = PASSWORD_RESET_SECONDS / 60;
  if (input.locale === "en") {
    return {
      to: input.to,
      subject: "Reset your password",
      text:
        `Hello${name === "" ? "" : ` ${name}`},\n\n` +
        "someone (hopefully you) asked to reset the password of your account on the shop platform. " +
        `Use this link to choose a new password. It works once and for ${minutes} minutes:\n\n` +
        `${input.link}\n\n` +
        "Wasn't you? Then just ignore this email. Your password stays as it is.\n",
    };
  }
  return {
    to: input.to,
    subject: "Passwort zurücksetzen",
    text:
      `Hallo${name === "" ? "" : ` ${name}`},\n\n` +
      "jemand (hoffentlich du) möchte das Passwort deines Kontos auf der Shop-Plattform zurücksetzen. " +
      `Über diesen Link wählst du ein neues Passwort. Er gilt einmal und ${minutes} Minuten lang:\n\n` +
      `${input.link}\n\n` +
      "Warst du das nicht? Dann ignoriere diese E-Mail einfach. Dein Passwort bleibt, wie es ist.\n",
  };
}

/**
 * Zählt E-Mails je Konto im gleitenden Fenster (Arbeitsspeicher, wie die Anmelde-Bremse).
 * Ab mehreren Instanzen zählt Valkey.
 */
export class ResetMailLimiter {
  private readonly sent = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly perWindow = PASSWORD_RESET_MAILS_PER_WINDOW,
    private readonly windowSeconds = PASSWORD_RESET_WINDOW_SECONDS,
    private readonly maxKeys = 100_000,
  ) {}

  /** `true`: Diese E-Mail darf raus (und ist gezählt). */
  take(userId: string): boolean {
    const t = this.now();
    const recent = (this.sent.get(userId) ?? []).filter((at) => t - at < this.windowSeconds * 1000);
    if (recent.length >= this.perWindow) {
      this.sent.set(userId, recent);
      return false;
    }
    if (!this.sent.has(userId) && this.sent.size >= this.maxKeys) {
      const oldest = this.sent.keys().next().value;
      if (oldest !== undefined) this.sent.delete(oldest);
    }
    this.sent.delete(userId);
    this.sent.set(userId, [...recent, t]);
    return true;
  }
}
