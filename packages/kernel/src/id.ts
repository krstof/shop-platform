// UUIDv7 nach RFC 9562 (Datenmodell 2.2): 48 Bit Zeitstempel in Millisekunden,
// danach Zufall aus dem kryptografischen Generator. Die Datenbank erzeugt sie mit
// `uuidv7()` selbst. Diese Funktion braucht der Code, wenn er eine ID vor dem
// Speichern kennen muss (zum Beispiel für Ereignisse in der Outbox).
import { randomBytes } from "node:crypto";
import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Jede UUID in Kleinbuchstaben (auch ältere oder fremde IDs). */
export const uuidSchema = z.string().regex(UUID_RE, "UUID in Kleinbuchstaben erwartet");

/** Nur UUIDv7. Für IDs, die die Plattform selbst vergibt. */
export const uuidV7Schema = z.string().regex(UUID_V7_RE, "UUIDv7 erwartet");

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

// Damit mehrere IDs in derselben Millisekunde trotzdem aufsteigend sortiert sind,
// wird der 12-Bit-Teil `rand_a` als Zähler benutzt (RFC 9562, Abschnitt 6.2, Methode 1).
// Läuft der Zähler über, wird der Zeitstempel künstlich um 1 ms erhöht.
let lastMs = -1;
let counter = 0;

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

/** Erzeugt eine neue UUIDv7. `now` ist nur für Tests gedacht. */
export function uuidv7(now: number = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    counter += 1;
    if (counter > 0x7ff) {
      ms += 1;
      counter = randomBytes(2).readUInt16BE(0) & 0x3ff;
    }
  } else {
    // Startwert zufällig, aber mit Luft nach oben (höchstes Bit frei).
    counter = randomBytes(2).readUInt16BE(0) & 0x3ff;
  }
  lastMs = ms;

  const rand = randomBytes(8);
  rand[0] = ((rand[0] ?? 0) & 0x3f) | 0x80; // Variante 10xx
  const timeHex = hex(ms, 12);
  const randHex = rand.toString("hex");
  return (
    `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-` +
    `7${hex(counter, 3)}-` +
    `${randHex.slice(0, 4)}-${randHex.slice(4, 16)}`
  );
}

/** Liest den Zeitstempel (Millisekunden seit 1970) aus einer UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  if (!isUuidV7(id)) throw new TypeError("Keine UUIDv7");
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
