// Subscriber `audit.record` (PLA-07, Etappe E5): schreibt aus jedem Ereignis aller Module einen
// Eintrag ins Änderungsprotokoll. audit kennt kein anderes Modul (module.json: dependsOn leer);
// es liest nur die Hülle und die Vereinbarung für Ereignisdaten (kernel/events/event.ts):
// `data.id` = betroffenes Objekt, `data.changes` = { feld: [alt, neu] }.
// Genau einmal: Die Inbox audit.processed_event verhindert doppelte Einträge (deliverEvent).
import { defineSubscriber, type EventEnvelope } from "@shop/kernel";
import { z } from "zod";
import type { DB } from "./db.generated.js";
import { insertAuditEntry, type NewAuditEntry } from "./internal/audit-repository.js";

// Nur die Felder, die audit braucht; der Rest der Daten bleibt draußen (keine Kopie fremder Daten).
const auditedData = z.looseObject({
  id: z.uuid().optional(),
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).optional(),
});

/** Übersetzt ein Ereignis in einen Protokolleintrag. Eigene Funktion, damit sie ohne Datenbank testbar ist. */
export function toAuditEntry(event: EventEnvelope): NewAuditEntry {
  if (event.tenantId === null) throw new Error("audit.record: Ereignis ohne Shop");
  const [module, thing] = event.type.split(".");
  const data = auditedData.safeParse(event.data);
  return {
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    actorType: event.actor.type,
    actorId: event.actor.id ?? null,
    action: event.type,
    entityType: `${module ?? ""}.${thing ?? ""}`,
    entityId: data.success ? (data.data.id ?? null) : null,
    changes: data.success ? (data.data.changes ?? null) : null,
    correlationId: event.correlationId,
  };
}

export const recordSubscriber = defineSubscriber<DB>({
  name: "audit.record",
  events: "*",
  handle: async (trx, event) => {
    await insertAuditEntry(trx, toAuditEntry(event));
  },
});
