// Passwörter (Sicherheit 5.2, SIC-02).
//
// Speichern: Argon2id mit 19 MiB Speicher, 2 Durchläufen, Parallelität 1 (OWASP-Mindestwert,
// bestätigt in Anforderungen 6.4). Der Hash enthält Verfahren und Werte selbst
// (`$argon2id$v=19$m=19456,t=2,p=1$...`), spätere stärkere Werte bleiben so lesbar.
//
// Regeln nach NIST SP 800-63B: 12 bis 128 Zeichen, alle Zeichen erlaubt, keine Zwangsregeln,
// dafür ein Abgleich mit einer mitgelieferten Liste häufiger gestohlener Passwörter
// (ohne Internetverbindung). Die Liste stammt aus SecLists (MIT-Lizenz), siehe data/README.md.
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { hash, verify } from "@node-rs/argon2";

/** `Algorithm.Argon2id` aus @node-rs/argon2 (dort ein `const enum`, das hier nicht importierbar ist). */
const ARGON2ID = 2;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Werte für Argon2id. Nicht senken: Der Test `password.test.ts` prüft die Untergrenzen. */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password.normalize("NFKC"), ARGON2_OPTIONS);
}

/** Vergleicht in konstanter Zeit. Ein kaputter oder fremder Hash ergibt `false`, nie einen Fehler. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (!storedHash.startsWith("$argon2id$")) return false;
  try {
    return await verify(storedHash, password.normalize("NFKC"));
  } catch {
    return false;
  }
}

export type PasswordProblem = "too_short" | "too_long" | "common" | "contains_email";

let commonPasswords: ReadonlySet<string> | undefined;

function loadCommonPasswords(): ReadonlySet<string> {
  if (commonPasswords !== undefined) return commonPasswords;
  const file = new URL("./data/common-passwords.txt.gz", import.meta.url);
  const text = gunzipSync(readFileSync(file)).toString("utf8");
  commonPasswords = new Set(text.split("\n").filter((line) => line.length > 0));
  return commonPasswords;
}

/** Zahl der Einträge in der Liste (für Tests und die Startprüfung). */
export function commonPasswordCount(): number {
  return loadCommonPasswords().size;
}

/**
 * Prüft ein neues Passwort. Gibt `undefined` zurück, wenn es erlaubt ist.
 * Länge zählt Unicode-Zeichen (Codepoints), nicht Bytes, damit Umlaute und Emojis fair zählen.
 */
export function checkNewPassword(password: string, email?: string): PasswordProblem | undefined {
  const normalized = password.normalize("NFKC");
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return "too_short";
  if (length > PASSWORD_MAX_LENGTH) return "too_long";
  const lower = normalized.toLowerCase();
  if (loadCommonPasswords().has(lower)) return "common";
  if (email !== undefined) {
    const local = email.toLowerCase().split("@")[0] ?? "";
    if (local.length >= 4 && lower.includes(local)) return "contains_email";
  }
  return undefined;
}
