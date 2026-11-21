// Texttabelle der Fehler in zwei Sprachen (Architektur 4.9, Entscheidung Kristof 30.10.2026).
// `code` ist fest, die Texte dürfen sich ändern. Neue Fehlercodes brauchen hier einen Eintrag,
// der Test in problem.test.ts prüft das für alle Fehlerklassen des Kernels.
import type { Locale } from "./locale.js";

type Texts = Readonly<Record<Locale, string>>;

export const PROBLEM_TITLES: Readonly<Record<string, Texts>> = {
  validation_failed: { de: "Die Eingabe ist ungültig.", en: "The input is invalid." },
  bad_request: { de: "Die Anfrage ist fehlerhaft.", en: "The request is malformed." },
  unauthenticated: { de: "Bitte melde dich an.", en: "Please sign in." },
  forbidden: { de: "Dafür fehlt die Berechtigung.", en: "You are not allowed to do this." },
  invalid_credentials: { de: "E-Mail oder Passwort ist falsch.", en: "Email or password is incorrect." },
  invalid_second_factor: {
    de: "Der Code ist falsch oder abgelaufen.",
    en: "The code is wrong or has expired.",
  },
  cross_origin_rejected: {
    de: "Anfrage von einer fremden Seite abgelehnt.",
    en: "Request from another site rejected.",
  },
  reauthentication_required: {
    de: "Bitte bestätige zuerst dein Passwort.",
    en: "Please confirm your password first.",
  },
  not_found: { de: "Nicht gefunden.", en: "Not found." },
  method_not_allowed: {
    de: "Diese Methode ist hier nicht erlaubt.",
    en: "This method is not allowed here.",
  },
  conflict: {
    de: "Die Aktion passt nicht zum aktuellen Zustand.",
    en: "The action does not match the current state.",
  },
  precondition_failed: {
    de: "Der Datensatz wurde inzwischen geändert.",
    en: "The record has been changed in the meantime.",
  },
  precondition_required: {
    de: "Bitte die Version mitschicken (If-Match).",
    en: "Please send the version (If-Match).",
  },
  idempotency_key_reused: {
    de: "Der Idempotency-Key gehört zu einer anderen Anfrage.",
    en: "The idempotency key belongs to a different request.",
  },
  idempotency_in_progress: {
    de: "Die Anfrage wird noch bearbeitet.",
    en: "The request is still being processed.",
  },
  payload_too_large: {
    de: "Die Anfrage ist zu groß. Bei Bildern sind bis 8 MB erlaubt.",
    en: "The request is too large. Images may be up to 8 MB.",
  },
  unsupported_media_type: {
    de: "Dieses Datenformat wird nicht unterstützt. Bitte JSON senden.",
    en: "This content type is not supported. Please send JSON.",
  },
  rate_limited: {
    de: "Zu viele Anfragen. Bitte warte kurz.",
    en: "Too many requests. Please wait a moment.",
  },
  internal_error: { de: "Ein unerwarteter Fehler ist aufgetreten.", en: "An unexpected error occurred." },
  service_unavailable: {
    de: "Der Dienst ist gerade nicht erreichbar.",
    en: "The service is currently unavailable.",
  },
};

/** Zusammenfassung bei Eingabefehlern, abhängig von der Zahl der fehlerhaften Felder. */
export function validationDetail(count: number, locale: Locale): string {
  if (locale === "en") return count === 1 ? "One field is invalid." : `${count} fields are invalid.`;
  return count === 1 ? "Ein Feld ist fehlerhaft." : `${count} Felder sind fehlerhaft.`;
}
