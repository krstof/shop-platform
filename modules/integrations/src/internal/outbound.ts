// Gemeinsamer Weg nach außen (21.11.2026).
//
// Jede Anbindung ruft einen fremden Dienst auf, über den wir nichts wissen: Er kann langsam sein,
// hängen bleiben, mit einer Fehlerseite antworten oder plötzlich ein Megabyte schicken. Damit das
// nie den Shop ausbremst, geht jeder Aufruf durch diese Stelle:
//
// - Zeitlimit (Standard 8 Sekunden), danach bricht der Aufruf ab.
// - Eine Wiederholung bei Netzproblemen und bei 429 oder 5xx, nicht bei 4xx (da hilft Warten nicht).
// - Größenbegrenzung der Antwort, damit kein fremder Dienst den Arbeitsspeicher füllt.
// - Ein Fehler, der dem Händler etwas sagt, statt einer technischen Meldung.

export class ExternalServiceError extends Error {
  /** HTTP-Status des fremden Dienstes, falls es einen gab. */
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ExternalServiceError";
    this.status = status;
  }
}

export interface ExternalRequest {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  /** Wird als JSON geschickt. */
  readonly body?: unknown;
  readonly timeoutMs?: number;
  /** Name des Dienstes für die Fehlermeldung, etwa „Telegram“. */
  readonly service: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

async function once(request: ExternalRequest): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json", ...request.headers };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  return fetch(request.url, {
    method: request.method ?? "GET",
    headers,
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    redirect: "error",
  });
}

/**
 * Ruft einen fremden Dienst auf und gibt die Antwort als JSON zurück.
 * Wirft {@link ExternalServiceError} mit einer Meldung, die man einem Händler zeigen kann.
 */
export async function fetchExternal<T>(request: ExternalRequest): Promise<T> {
  let response: Response;
  try {
    response = await once(request);
    if (response.status === 429 || response.status >= 500) response = await once(request);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError" ? "antwortet nicht" : "ist nicht erreichbar";
    throw new ExternalServiceError(`${request.service} ${reason}.`);
  }
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? "Die Zugangsdaten stimmen nicht."
        : response.status === 429
          ? "Zu viele Anfragen in kurzer Zeit, bitte später noch einmal."
          : response.status >= 500
            ? "Der Dienst hat gerade eine Störung."
            : "Die Anfrage wurde abgelehnt.";
    throw new ExternalServiceError(`${request.service}: ${hint}`, response.status);
  }
  const text = await readLimited(response, request.service);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ExternalServiceError(`${request.service} hat unerwartet geantwortet.`, response.status);
  }
}

/**
 * Holt ein Bild von einem fremden Dienst.
 *
 * Die Adresse darf nur aus der Antwort eines Anbieters stammen, nie aus dem Browser: Sonst könnte
 * jemand den Server dazu bringen, Adressen im eigenen Netz abzurufen. Zusätzlich muss sie https
 * sein und auf einen Namen mit Punkt zeigen, damit Dienste im Docker-Netz („garage“, „api“) außen
 * vor bleiben. Umleitungen sind aus demselben Grund verboten.
 */
export async function fetchExternalImage(
  url: string,
  service: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExternalServiceError(`${service} hat eine unbrauchbare Bildadresse geschickt.`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.includes(".") ||
    parsed.hostname.endsWith(".localhost")
  )
    throw new ExternalServiceError(`${service} hat eine unbrauchbare Bildadresse geschickt.`);
  let response: Response;
  try {
    response = await fetch(parsed.href, {
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch {
    throw new ExternalServiceError(`Das Bild bei ${service} ist nicht erreichbar.`);
  }
  if (!response.ok)
    throw new ExternalServiceError(`Das Bild bei ${service} ist nicht erreichbar.`, response.status);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!contentType.startsWith("image/"))
    throw new ExternalServiceError(`${service} hat kein Bild geschickt.`, response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw new ExternalServiceError(`Das Bild bei ${service} ist zu groß.`);
  return { bytes, contentType };
}

/** Liest die Antwort, bricht aber ab, wenn sie unangemessen groß wird. */
async function readLimited(response: Response, service: string): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ExternalServiceError(`${service} hat zu viele Daten geschickt.`);
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}
