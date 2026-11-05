// Lebenszeichen des Workers für den Gesundheitscheck des Containers (Etappe E5 Teil 2).
//
// Der Worker hat sonst keine Netzschnittstelle. Dieser kleine Server lauscht deshalb nur auf
// 127.0.0.1 im Container: Docker fragt ihn von innen ab, von außen ist er nie erreichbar (kein
// Port in Compose, kein Eintrag in Caddy). Er kennt genau eine Adresse, `GET /livez`, und verrät
// nichts außer „ok“ oder „nicht verfügbar“.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface HealthServerOptions {
  /** Port im Container; 0 wählt einen freien (nur Tests). */
  readonly port: number;
  /** Ist der Worker gerade gesund? */
  readonly isHealthy: () => boolean;
}

export interface RunningHealthServer {
  readonly port: number;
  close(): Promise<void>;
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export async function startHealthServer(options: HealthServerOptions): Promise<RunningHealthServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/livez") {
      res.writeHead(404, HEADERS).end('{"status":"not_found"}');
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...HEADERS, allow: "GET, HEAD" }).end('{"status":"method_not_allowed"}');
      return;
    }
    let healthy: boolean;
    try {
      healthy = options.isHealthy();
    } catch {
      healthy = false;
    }
    const body = healthy ? '{"status":"ok"}' : '{"status":"unavailable"}';
    res.writeHead(healthy ? 200 : 503, HEADERS).end(req.method === "HEAD" ? undefined : body);
  });
  // Kurze Zeitgrenzen: Der Gesundheitscheck braucht keine offenen Verbindungen.
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export interface HealthPolicy {
  /** So lange darf das Relay nach dem Start ohne fehlerfreien Durchgang sein. Standard 60 s. */
  readonly startupGraceMs?: number;
  /** So lange darf der letzte fehlerfreie Durchgang her sein. Standard 60 s. */
  readonly maxSilenceMs?: number;
}

/**
 * Gesund heißt: Der Worker läuft (nicht angehalten) und das Relay kommt an die Datenbank,
 * also gab es in der letzten Minute einen fehlerfreien Durchgang (oder der Start ist noch frisch).
 */
export function evaluateHealth(
  state: {
    readonly stopping: boolean;
    readonly startedAt: number;
    readonly lastSuccessAt: number | undefined;
  },
  now: number,
  policy: HealthPolicy = {},
): boolean {
  if (state.stopping) return false;
  const grace = policy.startupGraceMs ?? 60_000;
  const silence = policy.maxSilenceMs ?? 60_000;
  if (state.lastSuccessAt === undefined) return now - state.startedAt <= grace;
  return now - state.lastSuccessAt <= silence;
}

export interface UnhealthyExitOptions {
  /** Ist der Worker gerade gesund? */
  readonly isHealthy: () => boolean;
  /** So lange am Stück „krank“, dann `onUnhealthy`. */
  readonly afterMs: number;
  /** Abstand der Prüfungen. Standard 10 s. */
  readonly checkEveryMs?: number;
  /** Wird genau einmal aufgerufen (der Dienst beendet sich dann selbst). */
  readonly onUnhealthy: (unhealthyForMs: number) => void;
  /** Nur Tests: eigene Uhr. */
  readonly now?: () => number;
}

/**
 * Selbst-Neustart (Entscheidung Kristof 05.11.2026): Ist der Worker zu lange am Stück krank,
 * beendet er sich selbst; Docker startet ihn dann neu (`restart: unless-stopped`). So braucht
 * kein Wächter-Container Zugriff auf Docker.
 */
export function watchUnhealthy(options: UnhealthyExitOptions): { stop(): void; check(): void } {
  const now = options.now ?? Date.now;
  let unhealthySince: number | undefined;
  let fired = false;
  const check = () => {
    if (fired) return;
    let healthy: boolean;
    try {
      healthy = options.isHealthy();
    } catch {
      healthy = false;
    }
    if (healthy) {
      unhealthySince = undefined;
      return;
    }
    const t = now();
    unhealthySince ??= t;
    if (t - unhealthySince >= options.afterMs) {
      fired = true;
      options.onUnhealthy(t - unhealthySince);
    }
  };
  const timer = setInterval(check, options.checkEveryMs ?? 10_000);
  timer.unref();
  return { stop: () => clearInterval(timer), check };
}
