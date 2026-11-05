// Ereignisse nach dem Outbox-Muster (ADR-007, Architektur 3.5, Etappe E5).
//
// Ein Modul beschreibt jedes Ereignis mit `defineEvent` (Name und Zod-Schema) und schreibt es
// mit `publishEvent` in DERSELBEN Transaktion wie seine Datenänderung nach `kernel.outbox`.
// Entweder wird beides gespeichert oder nichts. Das Relay im Worker verteilt es danach.
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { ACTOR_TYPES, getContext, type Actor } from "../context.js";
import { isUuid, uuidv7 } from "../id.js";

/** `<modul>.<sache>.<vergangenheitsform>.v<n>`, gleiche Regel wie in der Datenbank. */
export const EVENT_TYPE_PATTERN = /^[a-z_]+\.[a-z_]+\.[a-z_]+\.v[0-9]+$/;

/** Einheitliche Hülle jedes Ereignisses (ADR-007). */
export const eventEnvelopeSchema = z.strictObject({
  id: z.uuid(),
  type: z.string().regex(EVENT_TYPE_PATTERN),
  /** `null` nur bei Ereignissen der Plattform-Verwaltung. */
  tenantId: z.uuid().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
  actor: z.strictObject({ type: z.enum(ACTOR_TYPES), id: z.uuid().optional() }),
  /** Verbindet alle Schritte eines Vorgangs, zum Beispiel Anfrage → Ereignis → Folgeereignis. */
  correlationId: z.uuid(),
  /** Ereignis, durch das dieses entstanden ist. `null`, wenn es direkt aus einer Anfrage kommt. */
  causationId: z.uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
});

export interface EventEnvelope<T = Record<string, unknown>> {
  readonly id: string;
  readonly type: string;
  readonly tenantId: string | null;
  readonly occurredAt: string;
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly data: T;
}

export interface EventDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly schema: z.ZodType<T>;
}

/**
 * Beschreibt ein Ereignis. Das Schema muss streng sein (`z.strictObject`), damit nie mehr Felder
 * hinausgehen als beschrieben, zum Beispiel versehentlich ein Geheimnis.
 *
 * Vereinbarung für alle Ereignisse (das Änderungsprotokoll `audit` liest sie, ohne die Module zu
 * kennen): `data.id` ist die ID des betroffenen Objekts; Änderungs-Ereignisse tragen zusätzlich
 * `data.changes` im Format `{ feld: [alt, neu] }`.
 */
export function defineEvent<S extends z.ZodObject>(type: string, schema: S): EventDefinition<z.infer<S>> {
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new TypeError(`Ereignisname „${type}“ passt nicht zu <modul>.<sache>.<vergangenheit>.v<n>`);
  }
  // Nur strenge Objekte: Unbekannte Felder dürfen nicht unbemerkt in die Outbox gelangen.
  if (schema._zod.def.catchall?._zod.def.type !== "never") {
    throw new TypeError(`Schema von ${type} muss z.strictObject sein`);
  }
  return Object.freeze({ type, schema: schema as unknown as z.ZodType<z.infer<S>> });
}

/** Prüft, ob ein Ereignis zu einer Definition gehört, und gibt die Daten mit Typ zurück. */
export function isEvent<T extends Record<string, unknown>>(
  definition: EventDefinition<T>,
  event: EventEnvelope<unknown>,
): event is EventEnvelope<T> {
  return event.type === definition.type;
}

/**
 * Schreibt ein Ereignis in die Outbox, in der laufenden Transaktion von `withTenantTransaction`
 * (oder `withPlatformTransaction`). Der Shop kommt aus der Transaktion selbst
 * (`kernel.current_tenant_id()`), kann also nicht von dem der Datenänderung abweichen.
 * Urheber und Vorgang (`correlationId`) kommen aus dem Anfrage-Kontext.
 */
export async function publishEvent<DB, T extends Record<string, unknown>>(
  trx: Transaction<DB>,
  definition: EventDefinition<T>,
  data: T,
): Promise<EventEnvelope<T>> {
  const parsed = definition.schema.parse(data);
  const context = getContext();
  const actor: Actor = context?.actor ?? { type: "system" };
  const correlationId =
    context?.correlationId !== undefined && isUuid(context.correlationId)
      ? context.correlationId
      : context?.requestId !== undefined && isUuid(context.requestId)
        ? context.requestId
        : uuidv7();
  const causationId = context?.causationId ?? null;
  const id = uuidv7();
  const actorJson = JSON.stringify(actor.id === undefined ? { type: actor.type } : actor);
  const { rows } = await sql<{ tenant_id: string | null; occurred_at: Date }>`
    insert into kernel.outbox (id, tenant_id, type, actor, correlation_id, causation_id, data)
    values (${id}, kernel.current_tenant_id(), ${definition.type}, ${actorJson}::jsonb,
            ${correlationId}, ${causationId}, ${JSON.stringify(parsed)}::jsonb)
    returning tenant_id, occurred_at`.execute(trx);
  const row = rows[0];
  if (row === undefined) throw new Error("Ereignis wurde nicht in die Outbox geschrieben");
  return {
    id,
    type: definition.type,
    tenantId: row.tenant_id,
    occurredAt: row.occurred_at.toISOString(),
    actor,
    correlationId,
    causationId,
    data: parsed,
  };
}
