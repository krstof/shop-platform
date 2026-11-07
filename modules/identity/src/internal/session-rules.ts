// Regeln für die Dauer einer Sitzung (Sicherheit 5.2).
//
// Händler (Backoffice): 12 Stunden ohne Aktivität, höchstens 7 Tage.
// Betreiber (Plattform-Verwaltung): 1 Stunde ohne Aktivität, höchstens 12 Stunden. Die strengere
// Regel gilt für jede Sitzung eines Betreiberkontos, auch wenn es zugleich in einem Shop arbeitet,
// weil ein gestohlenes Betreiber-Cookie sonst über den Umweg Backoffice länger gültig bliebe.
// Wer Betreiber ist, weiß das Modul platform; apps/api reicht es über `sessionKindOf` herein.
import { SESSION_IDLE_SECONDS, SESSION_MAX_AGE_SECONDS } from "./auth.js";

export type SessionKind = "standard" | "operator";

export interface SessionRules {
  /** Ohne Aktivität so lange gültig. */
  readonly idleSeconds: number;
  /** Ab Anmeldung höchstens so lange gültig, egal wie aktiv. */
  readonly maxAgeSeconds: number;
}

export const SESSION_RULES: Readonly<Record<SessionKind, SessionRules>> = {
  standard: { idleSeconds: SESSION_IDLE_SECONDS, maxAgeSeconds: SESSION_MAX_AGE_SECONDS },
  operator: { idleSeconds: 60 * 60, maxAgeSeconds: 12 * 60 * 60 },
};

/**
 * Nach dem Passwort hat man so lange Zeit, den Code aus der App einzugeben. Danach ist die halbe
 * Sitzung verfallen und die Anmeldung beginnt von vorn.
 */
export const PENDING_SECOND_FACTOR_SECONDS = 10 * 60;

/** Begonnene Einrichtung des zweiten Faktors verfällt nach dieser Zeit ohne Bestätigung. */
export const TWO_FACTOR_SETUP_SECONDS = 15 * 60;

/** So viele falsche Codes je Sitzung; danach wird die Sitzung beendet (Passwort erneut nötig). */
export const MAX_SECOND_FACTOR_FAILURES = 5;

/** „Zuletzt aktiv“ wird höchstens einmal je Minute geschrieben, nicht bei jeder Anfrage. */
export const LAST_SEEN_RESOLUTION_SECONDS = 60;
