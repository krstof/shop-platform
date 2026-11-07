// Einmalcodes aus einer Authenticator-App (TOTP nach RFC 6238, Sicherheit 5.2, ADR-011).
//
// Bewusst klein und ohne fremde Bibliothek: HMAC-SHA1, 6 Ziffern, 30 Sekunden, ein Zeitschritt
// Spielraum nach vorn und hinten (Uhren gehen nicht genau). Diese Werte verstehen alle gängigen Apps.
// Jeder Code gilt nur einmal: Wer einen Code mitliest, kann ihn nicht ein zweites Mal benutzen,
// weil der letzte benutzte Zeitschritt gespeichert wird (`lastUsedStep`).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Ein Zeitschritt Spielraum in jede Richtung, also höchstens 90 Sekunden Gültigkeit. */
export const TOTP_WINDOW = 1;
/** 160 Bit, wie RFC 4226 empfiehlt. */
export const TOTP_SECRET_BYTES = 20;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function newTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** Zeitschritt zu einem Zeitpunkt (Millisekunden). */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Code für einen Zeitschritt (RFC 4226, Kapitel 5.3). */
export function totpCode(secret: Uint8Array, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Nur Ziffern; Leerzeichen und Bindestriche, wie Apps sie anzeigen, werden entfernt. */
export function normalizeTotpInput(raw: string): string | undefined {
  const code = raw.replace(/[\s-]/g, "");
  return new RegExp(`^[0-9]{${TOTP_DIGITS}}$`).test(code) ? code : undefined;
}

/**
 * Prüft einen Code. Liefert den passenden Zeitschritt oder `undefined`.
 * Schritte bis einschließlich `lastUsedStep` zählen nicht mehr (kein zweites Mal, kein Zurück).
 * Alle Kandidaten werden geprüft, damit die Antwortzeit nicht verrät, welcher passte.
 */
export function verifyTotp(
  secret: Uint8Array,
  input: string,
  nowMs: number,
  lastUsedStep: number | undefined,
): number | undefined {
  const code = normalizeTotpInput(input);
  if (code === undefined) return undefined;
  const now = totpStep(nowMs);
  let match: number | undefined;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    const ok = timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code));
    if (ok && match === undefined && (lastUsedStep === undefined || step > lastUsedStep)) match = step;
  }
  return match;
}

/** Adresse für den QR-Code (Key Uri Format, wie Google Authenticator es festgelegt hat). */
export function otpauthUri(secret: Uint8Array, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Ersatzcodes ------------------------------------------------------------------------------

/** Ohne leicht verwechselbare Zeichen (0/o, 1/l/i). */
const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const BACKUP_CODE_COUNT = 10;
/** 10 Zeichen aus 31 ergeben rund 49 Bit je Code; geraten wird nur gebremst (5 Versuche je Sitzung). */
const BACKUP_CODE_LENGTH = 10;

export function newBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const bytes = randomBytes(BACKUP_CODE_LENGTH * 2);
    let code = "";
    // Ablehnen statt Modulo, damit jedes Zeichen gleich wahrscheinlich ist.
    for (const b of bytes) {
      if (code.length === BACKUP_CODE_LENGTH) break;
      if (b < 248) code += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    }
    while (code.length < BACKUP_CODE_LENGTH) {
      const b = randomBytes(1)[0] ?? 255;
      if (b < 248) code += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    }
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** Kleinbuchstaben, ohne Leerzeichen und Bindestriche. */
export function normalizeBackupCode(raw: string): string {
  return raw.toLowerCase().replace(/[\s-]/g, "");
}

/**
 * Sucht einen Ersatzcode in der Liste. Liefert die Liste ohne den benutzten Code oder `undefined`.
 * Vergleicht jeden Eintrag in gleicher Zeit.
 */
export function useBackupCode(codes: readonly string[], input: string): string[] | undefined {
  const wanted = Buffer.from(normalizeBackupCode(input).padEnd(BACKUP_CODE_LENGTH, " ").slice(0, 64));
  let found = -1;
  codes.forEach((c, i) => {
    const candidate = Buffer.from(normalizeBackupCode(c).padEnd(BACKUP_CODE_LENGTH, " "));
    const same = candidate.length === wanted.length && timingSafeEqual(candidate, wanted);
    if (same && found === -1) found = i;
  });
  return found === -1 ? undefined : codes.filter((_, i) => i !== found);
}
