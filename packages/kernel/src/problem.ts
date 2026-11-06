// Fehler im Format „Problem Details“ nach RFC 9457 (Architektur 4.9, Q-05, Sicherheit 5.13).
// Fachliche Fehler sind Unterklassen von AppError. Alles andere wird zu einem
// allgemeinen 500er ohne Einzelheiten: keine SQL-Texte, Pfade oder Bibliotheksnamen.
import { z } from "zod";
import { DEFAULT_LOCALE, type Locale } from "./locale.js";
import { PROBLEM_TITLES, validationDetail } from "./problem-texts.js";

export const PROBLEM_TYPE_BASE = "https://docs.shop.localhost/errors/";
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface FieldError {
  /** JSON Pointer (RFC 6901) auf das fehlerhafte Feld, zum Beispiel `/variants/0/price/amount`. */
  readonly path: string;
  /** Feste, maschinenlesbare Kennung, zum Beispiel `too_small`. */
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  /** Feste, maschinenlesbare Kennung. Texte dürfen sich ändern, `code` nicht. */
  readonly code: string;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
  readonly requestId: string;
}

interface AppErrorOptions {
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
  /** Ursache nur fürs Protokoll. Sie gelangt nie in die Antwort. */
  readonly cause?: unknown;
}

/** Basis aller erwarteten Fehler. `detail` und `errors` sind für Menschen und dürfen in die Antwort. */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  abstract readonly title: string;
  readonly detail: string | undefined;
  readonly errors: readonly FieldError[] | undefined;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? new.target.name, options.cause === undefined ? {} : { cause: options.cause });
    this.name = new.target.name;
    this.detail = options.detail;
    this.errors = options.errors;
  }
}

export class ValidationError extends AppError {
  readonly status = 422;
  readonly code = "validation_failed";
  readonly title = "Die Eingabe ist ungültig.";
}

export class BadRequestError extends AppError {
  readonly status = 400;
  readonly code = "bad_request";
  readonly title = "Die Anfrage ist fehlerhaft.";
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = "unauthenticated";
  readonly title = "Bitte melde dich an.";
}

/**
 * Anmeldung fehlgeschlagen. Immer dieselbe Antwort, ob die E-Mail unbekannt oder das Passwort
 * falsch ist (Sicherheit 5.2).
 */
export class InvalidCredentialsError extends AppError {
  readonly status = 401;
  readonly code = "invalid_credentials";
  readonly title = "E-Mail oder Passwort ist falsch.";
}

/** Ändernde Anfrage von einer fremden Webseite (CSRF, Sicherheit 5.5, B-11). */
export class CrossOriginRejectedError extends AppError {
  readonly status = 403;
  readonly code = "cross_origin_rejected";
  readonly title = "Anfrage von einer fremden Seite abgelehnt.";
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "forbidden";
  readonly title = "Dafür fehlt die Berechtigung.";
}

/**
 * Auch für Datensätze anderer Shops: immer 404, nie 403, damit niemand erfährt,
 * dass die ID existiert (Architektur 4.9).
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "not_found";
  readonly title = "Nicht gefunden.";
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "conflict";
  readonly title = "Die Aktion passt nicht zum aktuellen Zustand.";
}

export class PreconditionFailedError extends AppError {
  readonly status = 412;
  readonly code = "precondition_failed";
  readonly title = "Der Datensatz wurde inzwischen geändert.";
}

export class MethodNotAllowedError extends AppError {
  readonly status = 405;
  readonly code = "method_not_allowed";
  readonly title = "Diese Methode ist hier nicht erlaubt.";
}

/** If-Match fehlt bei einer Änderung, die ihn verlangt (RFC 6585). */
export class PreconditionRequiredError extends AppError {
  readonly status = 428;
  readonly code = "precondition_required";
  readonly title = "Bitte die Version mitschicken (If-Match).";
}

export class PayloadTooLargeError extends AppError {
  readonly status = 413;
  readonly code = "payload_too_large";
  readonly title = "Die Anfrage ist zu groß.";
}

export class UnsupportedMediaTypeError extends AppError {
  readonly status = 415;
  readonly code = "unsupported_media_type";
  readonly title = "Dieses Datenformat wird nicht unterstützt. Bitte JSON senden.";
}

export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = "rate_limited";
  readonly title = "Zu viele Anfragen. Bitte warte kurz.";
  /** Sekunden bis zum nächsten Versuch; die API schickt sie als `Retry-After`. */
  readonly retryAfterSeconds: number | undefined;

  constructor(options: AppErrorOptions & { readonly retryAfterSeconds?: number } = {}) {
    super(options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly code = "service_unavailable";
  readonly title = "Der Dienst ist gerade nicht erreichbar.";
}

const GENERIC_500 = {
  status: 500,
  code: "internal_error",
  title: "Ein unerwarteter Fehler ist aufgetreten.",
} as const;

function typeUrl(code: string): string {
  return PROBLEM_TYPE_BASE + code.replaceAll("_", "-");
}

/** Titel aus der Texttabelle in der gewünschten Sprache, sonst der deutsche Titel der Fehlerklasse. */
export function problemTitle(code: string, fallback: string, locale: Locale): string {
  return PROBLEM_TITLES[code]?.[locale] ?? fallback;
}

/**
 * Wandelt jeden Fehler in eine sichere Antwort. Nur AppError gibt Einzelheiten preis,
 * alle anderen Fehler ergeben einen allgemeinen 500er mit `requestId`.
 * Der Titel kommt in der gewünschten Sprache (Standard Deutsch).
 */
export function toProblemDetails(
  error: unknown,
  requestId: string,
  locale: Locale = DEFAULT_LOCALE,
): ProblemDetails {
  if (error instanceof AppError) {
    return {
      type: typeUrl(error.code),
      title: problemTitle(error.code, error.title, locale),
      status: error.status,
      code: error.code,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      ...(error.errors === undefined || error.errors.length === 0 ? {} : { errors: error.errors }),
      requestId,
    };
  }
  return {
    type: typeUrl(GENERIC_500.code),
    ...GENERIC_500,
    title: problemTitle(GENERIC_500.code, GENERIC_500.title, locale),
    requestId,
  };
}

/** Pfadteile als JSON Pointer: `["variants", 0, "price"]` → `/variants/0/price`. */
export function toJsonPointer(path: readonly PropertyKey[]): string {
  return path.map((p) => "/" + String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

/**
 * Macht aus einem Zod-Fehler einen ValidationError mit einer Zeile je Feld.
 * `prefix` stellt dem Pfad etwas voran, zum Beispiel `/query` für Abfrageparameter.
 * Die Feldtexte kommen aus Zod; für die passende Sprache beim Prüfen `zodErrorMap(locale)` mitgeben.
 */
export function validationErrorFromZod(
  error: z.ZodError,
  locale: Locale = DEFAULT_LOCALE,
  prefix = "",
): ValidationError {
  const errors: FieldError[] = [];
  for (const issue of error.issues) {
    // Unbekannte Felder meldet Zod gesammelt am Objekt; wir melden jedes Feld einzeln an seinem Pfad.
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        errors.push({
          path: prefix + toJsonPointer([...issue.path, key]),
          code: issue.code,
          message: UNKNOWN_FIELD[locale],
        });
      }
      continue;
    }
    errors.push({ path: prefix + toJsonPointer(issue.path), code: issue.code, message: issue.message });
  }
  return new ValidationError({ detail: validationDetail(errors.length, locale), errors });
}

const UNKNOWN_FIELD: Readonly<Record<Locale, string>> = {
  de: "Dieses Feld ist nicht erlaubt.",
  en: "This field is not allowed.",
};

const ZOD_LOCALES = { de: z.locales.de(), en: z.locales.en() } as const;

/** Fehlertexte von Zod in der gewünschten Sprache, als Option beim Prüfen: `safeParse(x, { error })`. */
export function zodErrorMap(locale: Locale): z.core.$ZodErrorMap {
  return ZOD_LOCALES[locale].localeError;
}
