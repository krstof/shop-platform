// Datenzugriff für das Änderungsprotokoll. Läuft immer in einer Transaktion für genau einen Shop
// (withTenantTransaction); die RLS-Regel liefert nur dessen Einträge. Einträge werden nur
// angehängt, nie geändert oder gelöscht (Trigger kernel.make_append_only, kein UPDATE/DELETE-Recht).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";

const TABLE = "audit.audit_entry";

const COLUMNS = [
  "id",
  "occurred_at",
  "actor_type",
  "actor_id",
  "on_behalf_of_user_id",
  "action",
  "entity_type",
  "entity_id",
  "changes",
  "correlation_id",
] as const;

export interface AuditEntryRow {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_id: string | null;
  on_behalf_of_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: unknown;
  correlation_id: string | null;
}

export interface NewAuditEntry {
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly changes: Record<string, unknown> | null;
  readonly correlationId: string;
}

export async function insertAuditEntry(trx: Transaction<DB>, entry: NewAuditEntry): Promise<void> {
  await trx
    .insertInto(TABLE)
    .values({
      tenant_id: entry.tenantId,
      occurred_at: entry.occurredAt,
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      changes: entry.changes === null ? null : JSON.stringify(entry.changes),
      correlation_id: entry.correlationId,
    })
    .execute();
}

export interface AuditFilter {
  readonly limit: number;
  /** Neueste zuerst: nur Einträge mit kleinerer ID (UUIDv7 ist zeitlich sortiert). */
  readonly beforeId?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly actorType?: string | undefined;
  readonly actorId?: string | undefined;
}

/** Liest eine Zeile mehr als verlangt, damit der Aufrufer weiß, ob es eine nächste Seite gibt. */
export async function findAuditEntries(trx: Transaction<DB>, filter: AuditFilter): Promise<AuditEntryRow[]> {
  let query = trx
    .selectFrom(TABLE)
    .select(COLUMNS)
    .orderBy("id", "desc")
    .limit(filter.limit + 1);
  if (filter.beforeId !== undefined) query = query.where("id", "<", filter.beforeId);
  if (filter.entityType !== undefined) query = query.where("entity_type", "=", filter.entityType);
  if (filter.entityId !== undefined) query = query.where("entity_id", "=", filter.entityId);
  if (filter.actorType !== undefined) query = query.where("actor_type", "=", filter.actorType);
  if (filter.actorId !== undefined) query = query.where("actor_id", "=", filter.actorId);
  return query.execute() as Promise<AuditEntryRow[]>;
}
