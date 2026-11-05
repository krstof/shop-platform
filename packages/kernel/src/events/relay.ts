// Relay (Weiterleiter) der Outbox (ADR-007, Architektur 3.5, Etappe E5).
//
// Liest neue Ereignisse aus `kernel.outbox` und stellt für jeden Subscriber, der darauf hört, eine
// Aufgabe in dessen Warteschlange. Lesen, Einstellen und Markieren als veröffentlicht geschehen in
// EINER Transaktion als shop_relay: Entweder ist das Ereignis markiert und alle Aufgaben stehen
// in der Warteschlange, oder nichts davon. Deshalb stellt das Relay nie doppelt ein, auch wenn es
// mittendrin abstürzt oder mehrfach läuft (`FOR UPDATE SKIP LOCKED`: zwei Relays teilen sich die
// Arbeit, statt dasselbe Ereignis zu greifen).
import { sql } from "kysely";
import { fromKysely } from "pg-boss";
import { withRelayTransaction, type Database } from "../db/database.js";
import type { JobQueue } from "../jobs/queue.js";
import type { EventEnvelope } from "./event.js";
import { subscribesTo, type Subscriber } from "./subscriber.js";

export interface RelayOptions {
  /** Verbindung als shop_relay. */
  readonly database: Database<unknown>;
  readonly queue: JobQueue;
  readonly subscribers: readonly Subscriber[];
  /** Höchstzahl Ereignisse je Durchgang. Standard 100. */
  readonly batchSize?: number;
}

export interface RelayResult {
  /** Als veröffentlicht markierte Ereignisse. */
  readonly published: number;
  /** Eingestellte Aufgaben (Ereignis × Subscriber). */
  readonly jobs: number;
}

interface OutboxRow {
  id: string;
  tenant_id: string | null;
  type: string;
  occurred_at: Date;
  actor: EventEnvelope["actor"];
  correlation_id: string;
  causation_id: string | null;
  data: Record<string, unknown>;
}

function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    id: row.id,
    type: row.type,
    tenantId: row.tenant_id,
    occurredAt: row.occurred_at.toISOString(),
    actor: row.actor,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    data: row.data,
  };
}

/** Ein Durchgang. Scheitert er, wird der Fehler an den Ereignissen vermerkt und weitergeworfen. */
export async function relayOutboxOnce(options: RelayOptions): Promise<RelayResult> {
  const limit = options.batchSize ?? 100;
  let ids: string[] = [];
  try {
    return await withRelayTransaction(options.database, async (trx) => {
      const { rows } = await sql<OutboxRow>`
        select id, tenant_id, type, occurred_at, actor, correlation_id, causation_id, data
          from kernel.outbox
         where published_at is null
         order by occurred_at, id
         limit ${limit}
           for update skip locked`.execute(trx);
      if (rows.length === 0) return { published: 0, jobs: 0 };
      ids = rows.map((r) => r.id);
      const db = fromKysely(trx);
      let jobs = 0;
      for (const subscriber of options.subscribers) {
        const batch = rows.filter((r) => subscribesTo(subscriber, r.type));
        if (batch.length === 0) continue;
        // Job-ID = Ereignis-ID: Gleiche Aufgabe kann es je Warteschlange nur einmal geben.
        await options.queue.boss.insert(
          subscriber.name,
          batch.map((r) => ({ id: r.id, data: toEnvelope(r) })),
          { db },
        );
        jobs += batch.length;
      }
      // Ereignisse ohne Subscriber werden ebenfalls markiert (später lesen Webhooks mit).
      await sql`
        update kernel.outbox
           set published_at = now(), attempts = attempts + 1, last_error = null
         where id = any(${ids}::uuid[])`.execute(trx);
      return { published: rows.length, jobs };
    });
  } catch (error) {
    if (ids.length > 0) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await withRelayTransaction(options.database, (trx) =>
        sql`update kernel.outbox set attempts = attempts + 1, last_error = ${message}
             where id = any(${ids}::uuid[]) and published_at is null`.execute(trx),
      ).catch(() => undefined);
    }
    throw error;
  }
}

export interface RunningRelay {
  /** Hält an, nachdem der laufende Durchgang fertig ist. */
  stop(): Promise<void>;
  /** Zeitpunkt (ms seit 1970) des letzten fehlerfreien Durchgangs; undefined, solange keiner gelang. */
  lastSuccessAt(): number | undefined;
}

export interface StartRelayOptions extends RelayOptions {
  /** Pause zwischen zwei Durchgängen ohne Arbeit, in Millisekunden. Standard 500. */
  readonly idleMs?: number;
  /** Pause nach einem Fehler, in Millisekunden. Standard 5000. */
  readonly errorBackoffMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly onRelayed?: (result: RelayResult) => void;
}

/** Läuft im Worker ständig: volle Durchgänge sofort hintereinander, sonst mit kurzer Pause. */
export function startRelay(options: StartRelayOptions): RunningRelay {
  let stopped = false;
  let lastSuccess: number | undefined;
  let wake: (() => void) | undefined;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  const limit = options.batchSize ?? 100;
  const loop = (async () => {
    while (!stopped) {
      try {
        const result = await relayOutboxOnce(options);
        lastSuccess = Date.now();
        if (result.published > 0) options.onRelayed?.(result);
        if (result.published < limit) await sleep(options.idleMs ?? 500);
      } catch (error) {
        options.onError?.(error);
        await sleep(options.errorBackoffMs ?? 5000);
      }
    }
  })();
  return {
    async stop() {
      stopped = true;
      wake?.();
      await loop;
    },
    lastSuccessAt: () => lastSuccess,
  };
}
