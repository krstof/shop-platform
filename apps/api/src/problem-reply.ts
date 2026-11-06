// Jede Fehlerantwort der API geht durch diese Funktion (Architektur 4.9, Q-05):
// Problem Details mit requestId, Titel in der Sprache der Anfrage, keine internen Einzelheiten.
import {
  AppError,
  BadRequestError,
  MethodNotAllowedError,
  NotFoundError,
  PayloadTooLargeError,
  PROBLEM_CONTENT_TYPE,
  RateLimitedError,
  toProblemDetails,
  UnsupportedMediaTypeError,
  type Locale,
  type Logger,
} from "@shop/kernel";
import type { FastifyReply } from "fastify";

const BAD_JSON: Readonly<Record<Locale, string>> = {
  de: "Der Inhalt ist kein gültiges JSON.",
  en: "The body is not valid JSON.",
};

/** Übersetzt Fehler von Fastify (Größe, Datenformat, kaputtes JSON) in unsere Fehlerklassen. */
export function normalizeError(error: unknown, locale: Locale): unknown {
  if (error instanceof AppError) return error;
  const e = error as { code?: unknown; statusCode?: unknown };
  if (typeof e?.code === "string" && e.code.startsWith("FST_")) {
    switch (e.code) {
      case "FST_ERR_CTP_BODY_TOO_LARGE":
        return new PayloadTooLargeError({ cause: error });
      case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
        return new UnsupportedMediaTypeError({ cause: error });
      case "FST_ERR_CTP_INVALID_JSON_BODY":
      case "FST_ERR_CTP_EMPTY_JSON_BODY":
        return new BadRequestError({ detail: BAD_JSON[locale], cause: error });
      case "FST_ERR_NOT_FOUND":
        return new NotFoundError({ cause: error });
      default:
        if (e.statusCode === 405) return new MethodNotAllowedError({ cause: error });
        if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500)
          return new BadRequestError({ cause: error });
    }
  }
  // Kaputtes JSON meldet Fastify als SyntaxError mit Status 400.
  if (error instanceof SyntaxError && (error as { statusCode?: unknown }).statusCode === 400)
    return new BadRequestError({ detail: BAD_JSON[locale], cause: error });
  return error;
}

export function sendProblem(
  reply: FastifyReply,
  error: unknown,
  requestId: string,
  locale: Locale,
  logger: Logger,
): FastifyReply {
  const normalized = normalizeError(error, locale);
  const problem = toProblemDetails(normalized, requestId, locale);
  if (problem.status >= 500)
    logger.error({ err: error, requestId }, "Anfrage mit unerwartetem Fehler beendet");
  else logger.debug({ code: problem.code, status: problem.status }, "Anfrage abgelehnt");
  if (problem.status === 401) reply.header("www-authenticate", "Bearer");
  if (normalized instanceof RateLimitedError && normalized.retryAfterSeconds !== undefined)
    reply.header("retry-after", String(Math.max(1, Math.ceil(normalized.retryAfterSeconds))));
  return reply
    .code(problem.status)
    .header("content-type", `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
    .header("cache-control", "no-store")
    .send(JSON.stringify(problem));
}
