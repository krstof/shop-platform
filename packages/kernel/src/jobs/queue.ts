// Warteschlange für Hintergrundaufgaben mit pg-boss (Architektur 3.1, BET-05, Etappe E5).
//
// pg-boss läuft vollständig in PostgreSQL, ein Zusatzdienst ist nicht nötig. Seine Tabellen legt
// der Migrationslauf an (Migration 20261105T060000_create_pgboss.sql). Zur Laufzeit darf pg-boss
// die Struktur nicht ändern: migrate und createSchema sind aus, die Rolle shop_relay hat nur
// Datenrechte. Passt die Schema-Version nicht zur installierten pg-boss-Version, startet nichts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import pg from "pg";
import { PgBoss, type Job, type JobResult, type Queue } from "pg-boss";

export const JOB_SCHEMA = "pgboss";

/**
 * Wiederholung bei Fehlern (BET-05): 10 Versuche mit wachsenden Abständen von 5 Sekunden bis
 * höchstens 15 Minuten, zusammen rund anderthalb Stunden. Danach bleibt die Aufgabe als
 * „failed“ liegen und ist für den Betreiber sichtbar (Oberfläche mit E20).
 */
export const DEFAULT_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  policy: "standard",
  partition: false,
  retryLimit: 10,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 300,
  // Erledigte Aufgaben 7 Tage aufheben (Fehlersuche), dann löscht pg-boss sie.
  deleteAfterSeconds: 7 * 24 * 3600,
  // Neue Aufgabe weckt den Worker sofort (LISTEN/NOTIFY); Abfragen im Takt bleiben als Rückfall.
  notify: true,
};

/** Höchstzahl Aufgaben, die ein Worker auf einmal abholt. Jede wird einzeln quittiert. */
export const JOB_BATCH_SIZE = 20;

export interface JobQueueOptions {
  /** Adresse als Rolle shop_relay. */
  readonly connectionString: string;
  readonly applicationName?: string;
  readonly maxConnections?: number;
  /** Fehler von pg-boss im Hintergrund (Verbindung weg, Wartung gescheitert). */
  readonly onError?: (error: Error) => void;
  /** Abstand der Abfragen nach neuen Aufgaben in Sekunden. Standard 2. */
  readonly pollingIntervalSeconds?: number;
}

/** Schema-Version, die die installierte pg-boss-Version erwartet. */
export function expectedJobSchemaVersion(): number {
  const require = createRequire(import.meta.url);
  // Paketwurzel aus dem Haupteinstieg, weil pg-boss package.json nicht exportiert.
  let dir = dirname(require.resolve("pg-boss"));
  for (let i = 0; i < 4; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        pgboss?: { schema?: number };
      };
      if (pkg.name === "pg-boss" && typeof pkg.pgboss?.schema === "number") return pkg.pgboss.schema;
    } catch {
      // weiter nach oben
    }
    dir = dirname(dir);
  }
  throw new Error("Schema-Version von pg-boss nicht gefunden");
}

export class JobSchemaMismatchError extends Error {
  constructor(found: number | null, expected: number) {
    super(
      found === null
        ? "Warteschlange ist nicht eingerichtet: zuerst den Dienst migrate laufen lassen"
        : `Warteschlange hat Schema-Version ${String(found)}, pg-boss erwartet ${String(expected)}: Migration fehlt`,
    );
    this.name = "JobSchemaMismatchError";
  }
}

export interface JobQueue {
  /** Legt eine Warteschlange an oder lässt sie, wie sie ist. */
  ensureQueue(name: string, options?: Omit<Queue, "name">): Promise<void>;
  /**
   * Verarbeitet Aufgaben, je bis zu JOB_BATCH_SIZE abgeholt, nacheinander und jede für sich:
   * Wirft der Handler, wiederholt pg-boss nur diese Aufgabe später, die anderen gelten als erledigt.
   */
  work(name: string, handler: (job: Job<unknown>) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Nur für das Relay und Tests im Kernel. */
  readonly boss: PgBoss;
}

/** Liest die eingetragene Schema-Version, bevor pg-boss selbst startet. */
async function installedJobSchemaVersion(connectionString: string): Promise<number | null> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const exists = await client.query<{ t: string | null }>(
      `select to_regclass('${JOB_SCHEMA}.version')::text as t`,
    );
    if (exists.rows[0]?.t === null || exists.rows[0]?.t === undefined) return null;
    const r = await client.query<{ version: number }>(
      `select max(version) as version from ${JOB_SCHEMA}.version`,
    );
    return r.rows[0]?.version ?? null;
  } finally {
    await client.end();
  }
}

export async function startJobQueue(options: JobQueueOptions): Promise<JobQueue> {
  const expected = expectedJobSchemaVersion();
  const found = await installedJobSchemaVersion(options.connectionString);
  if (found !== expected) throw new JobSchemaMismatchError(found, expected);
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: JOB_SCHEMA,
    application_name: options.applicationName ?? "shop-worker",
    max: options.maxConnections ?? 5,
    migrate: false,
    createSchema: false,
    // Wartung (Abgelaufenes wiederholen, Altes löschen) läuft im Worker mit.
    supervise: true,
    schedule: true,
    useListenNotify: true,
  });
  boss.on("error", (error: Error) => options.onError?.(error));
  await boss.start();
  const polling = options.pollingIntervalSeconds ?? 2;
  return {
    boss,
    async ensureQueue(name, queueOptions = DEFAULT_QUEUE_OPTIONS) {
      if ((await boss.getQueue(name)) === null) await boss.createQueue(name, queueOptions);
    },
    async work(name, handler) {
      await boss.work(
        name,
        {
          batchSize: JOB_BATCH_SIZE,
          // Volle Abholung: sofort weiter, bis die Warteschlange leer ist. Danach im Takt abfragen,
          // auch wenn LISTEN/NOTIFY eingeschaltet ist (pg-boss würde dann nur alle 30 s nachsehen).
          burstWhenBatchFull: true,
          pollingIntervalSeconds: polling,
          notifyPollingIntervalSeconds: polling,
          perJobResults: true,
        },
        async (jobs: Job<unknown>[]) => {
          const results: JobResult[] = [];
          for (const job of jobs) {
            try {
              await handler(job);
              results.push({ id: job.id, status: "completed" });
            } catch (error) {
              // Nur die Meldung speichern, nie Daten der Aufgabe (können persönliche Angaben enthalten).
              const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
              results.push({ id: job.id, status: "failed", output: { message } });
            }
          }
          return results;
        },
      );
    },
    async stop() {
      await boss.stop({ graceful: true, close: true, timeout: 10_000 });
    },
  };
}
