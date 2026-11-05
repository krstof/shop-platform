// Lesen des Änderungsprotokolls in der Admin-API (PLA-07, Etappe E5). Der Händler sieht nur die
// Einträge seines Shops (RLS). Neueste zuerst, mit Filter nach Objekt und Urheber.
import {
  decodeCursor,
  defineEndpoint,
  listQuery,
  pageOf,
  timestamp,
  toPage,
  type Endpoint,
} from "@shop/http";
import { ACTOR_TYPES, withTenantTransaction, type Database } from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../../db.generated.js";
import { findAuditEntries, type AuditEntryRow } from "../../internal/audit-repository.js";

const cursorKey = z.strictObject({ id: z.uuid() });

export const auditEntrySchema = z
  .object({
    id: z.uuid(),
    occurredAt: timestamp,
    actor: z.object({
      type: z.string().meta({ description: "user, api_token, ai, app, system oder operator" }),
      id: z.uuid().nullable(),
      onBehalfOfUserId: z.uuid().nullable(),
    }),
    action: z.string().meta({ description: "Ereignis, zum Beispiel catalog.manufacturer.updated.v1." }),
    entity: z.object({
      type: z.string().meta({ description: "Art des Objekts, zum Beispiel catalog.manufacturer." }),
      id: z.uuid().nullable(),
    }),
    changes: z
      .record(z.string(), z.tuple([z.unknown(), z.unknown()]))
      .nullable()
      .meta({ description: "Geänderte Felder als { feld: [alt, neu] }, sonst null." }),
    correlationId: z.uuid().nullable(),
  })
  .meta({ id: "AuditEntry", description: "Eintrag im Änderungsprotokoll: wer hat was wann getan." });

export type AuditEntry = z.infer<typeof auditEntrySchema>;

function toAuditEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actor: { type: row.actor_type, id: row.actor_id, onBehalfOfUserId: row.on_behalf_of_user_id },
    action: row.action,
    entity: { type: row.entity_type, id: row.entity_id },
    changes: (row.changes ?? null) as AuditEntry["changes"],
    correlationId: row.correlation_id,
  };
}

const entityType = z
  .string()
  .regex(/^[a-z_]+\.[a-z_]+$/)
  .max(100)
  .optional()
  .meta({ description: "Nur Einträge zu dieser Art von Objekt, zum Beispiel catalog.manufacturer." });

export function auditEndpoints(db: Database<DB>): Endpoint[] {
  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/audit-entries",
    operationId: "listAuditEntries",
    summary: "Änderungsprotokoll lesen",
    description:
      "Listet die Einträge im Änderungsprotokoll des Shops, neueste zuerst, seitenweise mit Cursor. " +
      "Einträge entstehen aus den Ereignissen der Module mit wenigen Sekunden Verzögerung und lassen " +
      "sich weder ändern noch löschen.",
    tags: ["Änderungsprotokoll"],
    access: { scopes: ["audit:read"] },
    query: listQuery({
      entityType,
      entityId: z.uuid().optional().meta({ description: "Nur Einträge zu diesem Objekt." }),
      actorType: z
        .enum([...ACTOR_TYPES, "operator"])
        .optional()
        .meta({ description: "Nur diese Art Urheber." }),
      actorId: z.uuid().optional().meta({ description: "Nur dieser Urheber." }),
    }),
    response: { status: 200, description: "Eine Seite mit Einträgen.", schema: pageOf(auditEntrySchema) },
    handler: async ({ query, locale }) => {
      const before =
        query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const rows = await withTenantTransaction(db, (trx) =>
        findAuditEntries(trx, {
          limit: query.limit,
          beforeId: before,
          entityType: query.entityType,
          entityId: query.entityId,
          actorType: query.actorType,
          actorId: query.actorId,
        }),
      );
      return toPage(rows, query.limit, (r) => ({ id: r.id }), toAuditEntry);
    },
  });
  return [list];
}
