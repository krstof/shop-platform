// Technische Protokolle mit pino (Sicherheit 5.12, Q-16, T-19).
// Eine zentrale Schwärzung entfernt Passwörter, Tokens, Cookies, Zahlungsdaten und
// volle IP-Adressen, egal wie tief sie in einem Objekt stecken. Jede Zeile trägt
// `requestId` und `tenantId` aus dem Anfrage-Kontext.
import pino, {
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";
import { getContext } from "./context.js";
import { truncateIp } from "./ip.js";

export type { Logger } from "pino";

export const REDACTED = "[geschwärzt]";

/**
 * Wortteile in Feldnamen, deren Wert immer geschwärzt wird. Feldnamen werden an
 * camelCase, Bindestrichen und Unterstrichen zerlegt: `newPassword`, `x-api-key`,
 * `sessionToken`, `set-cookie`, `card_number` werden erkannt, `publicUrl` nicht.
 */
const SENSITIVE_WORDS = new Set([
  "pass",
  "passwd",
  "password",
  "passwords",
  "passwort",
  "passphrase",
  "pwd",
  "secret",
  "secrets",
  "token",
  "tokens",
  "auth",
  "authorization",
  "authorisation",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "session",
  "sessions",
  "otp",
  "totp",
  "recovery",
  "card",
  "pan",
  "cvc",
  "cvv",
  "iban",
  "bic",
  "signature",
  "hmac",
  "ciphertext",
  "jwt",
  "apikey",
  "privatekey",
]);
/** Paare benachbarter Wortteile, die zusammen sensibel sind (`apiKey`, `private_key`). */
const SENSITIVE_PAIRS = new Set(["api key", "private key", "master key", "secret key", "access key"]);
/** Für Feldnamen ohne Trennzeichen (`accesstoken`, `setcookie`): Teilzeichenketten. */
const SENSITIVE_SUBSTRINGS =
  /password|passwort|secret|token|cookie|apikey|authorization|credential|signature|session/;

export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
  if (words.some((w) => SENSITIVE_WORDS.has(w))) return true;
  for (let i = 0; i + 1 < words.length; i++) {
    if (SENSITIVE_PAIRS.has(`${words[i] ?? ""} ${words[i + 1] ?? ""}`)) return true;
  }
  return words.some((w) => w.length > 6 && SENSITIVE_SUBSTRINGS.test(w));
}

/** Feldnamen mit IP-Adressen. Der Wert wird gekürzt statt geschwärzt. */
const IP_KEY_RE =
  /^(ip|ips|ip[-_]?address|remote[-_]?address|client[-_]?ip|x[-_]forwarded[-_]for|x[-_]real[-_]ip)$/i;

/** Muster in freiem Text (Meldungen, Fehlertexte, Adressen). */
const TEXT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Authorization-Kopfzeilen im Text
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`],
  // Zugangsdaten in Adressen: postgres://nutzer:passwort@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, `$1:${REDACTED}@`],
  // Schlüssel=Wert in Abfragen, Cookies und Formularen
  [
    /\b([\w-]*(?:pass(?:word|wort)?|secret|token|api[-_]?key|session|cookie|signature|otp)[\w-]*)=([^&;\s"']+)/gi,
    `$1=${REDACTED}`,
  ],
];

const IPV4_IN_TEXT = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Zusammenhängende IPv6-Adressen mit mindestens drei Doppelpunkten; Zeitangaben wie 14:00:00 haben nur zwei.
const IPV6_IN_TEXT = /(?<![\w:.])(?:[0-9a-f]{0,4}:){3,7}[0-9a-f]{0,4}(?![\w:])/gi;

export function scrubText(text: string): string {
  let out = text;
  for (const [re, replacement] of TEXT_PATTERNS) out = out.replace(re, replacement);
  out = out.replace(IPV4_IN_TEXT, (m) => truncateIp(m) ?? m);
  out = out.replace(IPV6_IN_TEXT, (m) => truncateIp(m) ?? m);
  return out;
}

function scrubIp(value: unknown): unknown {
  if (typeof value === "string") {
    // Auch Listen wie bei X-Forwarded-For: "1.2.3.4, 5.6.7.8"
    return value
      .split(",")
      .map((part) => {
        const p = part.trim();
        return truncateIp(p) ?? (p === "" ? p : REDACTED);
      })
      .join(", ");
  }
  if (Array.isArray(value)) return value.map(scrubIp);
  return REDACTED;
}

const MAX_DEPTH = 12;

/**
 * Gibt eine geschwärzte Kopie zurück. Das Original bleibt unverändert.
 * Fehlerobjekte werden in `{ type, message, stack, code }` umgewandelt und ebenfalls geschwärzt.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[zu tief]";
  if (seen.has(value)) return "[Kreisverweis]";
  seen.add(value);

  if (value instanceof Error) {
    const e = value as Error & { code?: unknown; cause?: unknown };
    const out: Record<string, unknown> = { type: e.name, message: scrubText(e.message) };
    if (e.stack !== undefined) out["stack"] = scrubText(e.stack);
    if (typeof e.code === "string" || typeof e.code === "number") out["code"] = e.code;
    if (e.cause !== undefined) out["cause"] = redact(e.cause, depth + 1, seen);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[${value.byteLength} Byte]`;
  if (value instanceof Map) {
    return redact(Object.fromEntries(value), depth + 1, seen);
  }
  if (value instanceof URL) return scrubText(value.href);

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (IP_KEY_RE.test(key)) out[key] = scrubIp(v);
    else if (isSensitiveKey(key)) out[key] = v === undefined || v === null || v === "" ? v : REDACTED;
    else out[key] = redact(v, depth + 1, seen);
  }
  return out;
}

export interface CreateLoggerOptions {
  readonly level?: string;
  readonly name?: string;
  /** Nur für Tests: Ziel der Ausgabe. Standard ist die Standardausgabe. */
  readonly destination?: DestinationStream;
}

/**
 * Erzeugt den Protokollschreiber. Alle Dienste benutzen ausschließlich ihn,
 * damit die Schwärzung nicht umgangen werden kann.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const pinoOptions: LoggerOptions = {
    level: options.level ?? "info",
    ...(options.name === undefined ? {} : { name: options.name }),
    base: null, // keine Rechnernamen oder Prozess-IDs
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: "msg",
    // pino wendet seine Umwandler nach `formatters.log` an. Der Fehler ist dann schon
    // geschwärzt und soll unverändert bleiben.
    serializers: { err: (value: unknown) => value },
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => redact(bindings) as Record<string, unknown>,
      log: (object) => redact(object) as Record<string, unknown>,
    },
    mixin() {
      const ctx = getContext();
      if (ctx === undefined) return {};
      return {
        requestId: ctx.requestId,
        ...(ctx.tenantId === undefined ? {} : { tenantId: ctx.tenantId }),
        ...(ctx.correlationId === undefined ? {} : { correlationId: ctx.correlationId }),
      };
    },
    hooks: {
      // Freitext-Meldungen und Formatargumente ebenfalls schwärzen.
      logMethod(args, method) {
        let list: unknown[] = args;
        // logger.error(err) übernimmt sonst die ungeschwärzte Fehlermeldung als `msg`.
        const [first, ...rest] = list;
        if (first instanceof Error) {
          list = [{ err: first }, ...(rest.length > 0 ? rest : [first.message])];
        }
        const cleaned = list.map((a) => (typeof a === "string" ? scrubText(a) : a));
        return method.apply(this, cleaned as Parameters<typeof method>);
      },
    },
  };
  const logger =
    options.destination === undefined ? pino(pinoOptions) : pino(pinoOptions, options.destination);
  return withRedactedChildren(logger);
}

/**
 * pino wendet `formatters.bindings` absichtlich nicht auf Kind-Protokolle an.
 * Deshalb werden die Felder von `logger.child({...})` hier vorab geschwärzt, auch für Enkel.
 */
function withRedactedChildren(logger: Logger): Logger {
  // Die Typen von pino für Kind-Protokolle mit eigenen Stufen passen nicht direkt; wir nutzen keine.
  const original = logger.child.bind(logger) as unknown as (
    bindings: Bindings,
    options?: ChildLoggerOptions,
  ) => Logger;
  const child = (bindings: Bindings, childOptions?: ChildLoggerOptions): Logger =>
    withRedactedChildren(original(redact(bindings) as Bindings, childOptions));
  Object.defineProperty(logger, "child", { value: child, writable: true, configurable: true });
  return logger;
}
