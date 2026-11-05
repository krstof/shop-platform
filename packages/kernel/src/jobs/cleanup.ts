// Aufräumen (Etappe E5): abgelaufene Idempotenz-Schlüssel (Architektur 4.5, nach 24 Stunden)
// und veröffentlichte Ereignisse der Outbox nach einer Aufbewahrungsfrist (ADR-007).
// Läuft im Worker als Rolle shop_relay; deren Policies lassen nur abgelaufene Schlüssel zu.
import { sql } from "kysely";
import { withRelayTransaction, type Database } from "../db/database.js";

export interface CleanupOptions {
  /** Veröffentlichte Ereignisse so viele Tage aufheben. Standard 30. */
  readonly outboxRetentionDays?: number;
  /** Höchstzahl gelöschter Zeilen je Tabelle und Durchgang, damit keine lange Sperre entsteht. */
  readonly batchSize?: number;
}

export interface CleanupResult {
  readonly idempotencyKeys: number;
  readonly outboxEvents: number;
}

export async function cleanupExpired(
  database: Database<unknown>,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const days = options.outboxRetentionDays ?? 30;
  const limit = options.batchSize ?? 10_000;
  if (!Number.isInteger(days) || days < 1) throw new RangeError("outboxRetentionDays muss mindestens 1 sein");
  return withRelayTransaction(database, async (trx) => {
    const keys = await sql`
      delete from kernel.idempotency_key
       where (tenant_id, id) in (
         select tenant_id, id from kernel.idempotency_key where expires_at < now() limit ${limit})`.execute(
      trx,
    );
    const events = await sql`
      delete from kernel.outbox
       where id in (
         select id from kernel.outbox
          where published_at is not null and published_at < now() - make_interval(days => ${days})
          limit ${limit})`.execute(trx);
    return {
      idempotencyKeys: Number(keys.numAffectedRows ?? 0n),
      outboxEvents: Number(events.numAffectedRows ?? 0n),
    };
  });
}
