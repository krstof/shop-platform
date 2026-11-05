// Der Worker (Etappe E5): startet die Warteschlange, für jeden Subscriber eine Verarbeitung,
// das Relay der Outbox und das stündliche Aufräumen. Gibt eine Funktion zum geordneten Anhalten
// zurück: erst das Relay, dann die Warteschlange (laufende Aufgaben dürfen fertig werden).
import type { Database, Logger, Subscriber } from "@shop/kernel";
import { cleanupExpired, deliverEvent, startJobQueue, startRelay, type JobQueue } from "@shop/kernel/worker";
import { evaluateHealth, type HealthPolicy } from "./health.js";

/** Warteschlange des Aufräumens. Läuft stündlich; pg-boss sorgt dafür, dass es nur einmal läuft. */
export const CLEANUP_QUEUE = "kernel.cleanup";
const CLEANUP_CRON = "17 * * * *";

export interface WorkerOptions {
  /** Verbindung als shop_app (Verarbeitung je Shop). */
  readonly appDatabase: Database<unknown>;
  /** Verbindung als shop_relay (Outbox, Aufräumen). */
  readonly relayDatabase: Database<unknown>;
  /** Adresse als shop_relay für pg-boss (eigener Verbindungspool). */
  readonly queueConnectionString: string;
  readonly subscribers: readonly Subscriber[];
  readonly logger: Logger;
  readonly outboxRetentionDays?: number;
  /** Nur Tests: schnellere Abfragen. */
  readonly pollingIntervalSeconds?: number;
  readonly relayIdleMs?: number;
  /** Nur Tests: andere Grenzen für das Lebenszeichen. */
  readonly health?: HealthPolicy;
}

export interface RunningWorker {
  readonly queue: JobQueue;
  /** Für das Lebenszeichen (/livez): läuft und erreicht die Datenbank. */
  isHealthy(now?: number): boolean;
  stop(): Promise<void>;
}

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const { logger } = options;
  const startedAt = Date.now();
  let stopping = false;
  const queue = await startJobQueue({
    connectionString: options.queueConnectionString,
    applicationName: "worker",
    onError: (error) => logger.error({ err: error }, "Fehler in der Warteschlange"),
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  });

  for (const subscriber of options.subscribers) {
    await queue.ensureQueue(subscriber.name);
    await queue.work(subscriber.name, async (job) => {
      try {
        const result = await deliverEvent(options.appDatabase, subscriber, job.data);
        logger.debug({ subscriber: subscriber.name, eventId: job.id, result }, "Ereignis verarbeitet");
      } catch (error) {
        // Ohne Inhalt des Ereignisses ins Protokoll: Daten können persönliche Angaben enthalten.
        logger.warn(
          { err: error, subscriber: subscriber.name, eventId: job.id },
          "Ereignis nicht verarbeitet, wird wiederholt",
        );
        throw error;
      }
    });
  }

  await queue.ensureQueue(CLEANUP_QUEUE, {
    policy: "singleton",
    partition: false,
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 600,
    deleteAfterSeconds: 7 * 24 * 3600,
    notify: true,
  });
  await queue.work(CLEANUP_QUEUE, async () => {
    const result = await cleanupExpired(options.relayDatabase, {
      ...(options.outboxRetentionDays === undefined
        ? {}
        : { outboxRetentionDays: options.outboxRetentionDays }),
    });
    logger.info(result, "Aufgeräumt");
  });
  await queue.boss.schedule(CLEANUP_QUEUE, CLEANUP_CRON, null, { tz: "UTC" });

  const relay = startRelay({
    database: options.relayDatabase,
    queue,
    subscribers: options.subscribers,
    onError: (error) => logger.error({ err: error }, "Relay gescheitert, neuer Versuch in Kürze"),
    onRelayed: (result) => logger.debug(result, "Ereignisse weitergeleitet"),
    ...(options.relayIdleMs === undefined ? {} : { idleMs: options.relayIdleMs }),
  });
  logger.info({ subscribers: options.subscribers.map((s) => s.name) }, "Worker gestartet");

  return {
    queue,
    isHealthy: (now = Date.now()) =>
      evaluateHealth({ stopping, startedAt, lastSuccessAt: relay.lastSuccessAt() }, now, options.health),
    async stop() {
      stopping = true;
      await relay.stop();
      await queue.stop();
      logger.info("Worker angehalten");
    },
  };
}
