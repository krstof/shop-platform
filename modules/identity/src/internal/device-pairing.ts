// Uhr verbinden (15.11.2026): kurzer Kopplungscode, den man auf der Uhr eintippen kann.
// 8 Ziffern (100 Millionen Möglichkeiten), 10 Minuten gültig, nur einmal; die Auth-API bremst
// Fehlversuche je Netz. Gespeichert wird nur der SHA-256 mit eigenem Präfix.
import { createHash, randomInt } from "node:crypto";

export const DEVICE_PAIRING_SECONDS = 10 * 60;
export const PAIRING_CODE_PATTERN = /^\d{8}$/;
/** Name des Tokens, das die Uhr bekommt (erscheint in der Liste der API-Token). */
export const WATCH_TOKEN_NAME = "Uhr (Bestellungen)";

export function newPairingCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

export function hashPairingCode(code: string): Buffer {
  return createHash("sha256").update(`device-pairing:${code}`, "utf8").digest();
}

/** Für die Anzeige: „1234 5678“. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}
