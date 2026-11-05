// Subscriber (Interessenten) für Ereignisse aus der Outbox (ADR-007, Etappe E5).
//
// Eine Aufgabe in der Warteschlange kann mehr als einmal ankommen (Wiederholung nach Fehler,
// Absturz zwischen Verarbeiten und Quittieren). `deliverEvent` sorgt dafür, dass die Wirkung
// trotzdem genau einmal eintritt: Es trägt die Ereignis-ID in die Inbox-Tabelle
// `<schema>.processed_event` des Moduls ein und führt den Subscriber in DERSELBEN Transaktion
// aus. Ist die ID schon da, passiert nichts. Scheitert der Subscriber, wird auch der Eintrag
// zurückgerollt, und die nächste Wiederholung versucht es erneut.
import { sql, type Transaction } from "kysely";
import { runWithContext } from "../context.js";
import { withTenantTransaction, type Database } from "../db/database.js";
import { uuidv7 } from "../id.js";
import { eventEnvelopeSchema, type EventDefinition, type EventEnvelope } from "./event.js";

/** `<schema>.<name>`, zum Beispiel `audit.record`. Zugleich der Name der Warteschlange. */
const SUBSCRIBER_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Fertiger Subscriber. Die Typen des Modul-Schemas stecken nur noch im Handler. */
export interface Subscriber {
  readonly name: string;
  /** Schema des Moduls; dort liegt die Inbox-Tabelle `processed_event`. */
  readonly schema: string;
  /** Ereignisse, auf die der Subscriber hört, oder `"*"` für alle (nur `audit`). */
  readonly events: readonly EventDefinition[] | "*";
  readonly handle: (trx: Transaction<unknown>, event: EventEnvelope) => Promise<void>;
}

export interface SubscriberOptions<DB> {
  readonly name: string;
  readonly events: readonly EventDefinition[] | "*";
  /** Läuft als shop_app in einer Transaktion für den Shop des Ereignisses. */
  readonly handle: (trx: Transaction<DB>, event: EventEnvelope) => Promise<void>;
}

export function defineSubscriber<DB>(options: SubscriberOptions<DB>): Subscriber {
  if (!SUBSCRIBER_NAME.test(options.name)) {
    throw new TypeError(`Subscriber-Name „${options.name}“ muss <schema>.<name> sein`);
  }
  if (options.events !== "*") {
    if (options.events.length === 0) throw new TypeError(`${options.name}: hört auf kein Ereignis`);
    const types = options.events.map((e) => e.type);
    if (new Set(types).size !== types.length) throw new TypeError(`${options.name}: Ereignis doppelt`);
  }
  const schema = options.name.slice(0, options.name.indexOf("."));
  const handle = (trx: Transaction<unknown>, event: EventEnvelope) =>
    options.handle(trx as unknown as Transaction<DB>, event);
  return Object.freeze({ name: options.name, schema, events: options.events, handle });
}

/** Ob ein Subscriber ein Ereignis dieses Typs bekommen soll. */
export function subscribesTo(subscriber: Subscriber, type: string): boolean {
  return subscriber.events === "*" || subscriber.events.some((e) => e.type === type);
}

export class EventDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventDeliveryError";
  }
}

export type DeliveryResult = "processed" | "duplicate";

/**
 * Verarbeitet ein Ereignis aus der Warteschlange genau einmal. `database` ist die Verbindung als
 * shop_app. Wirft bei Fehlern, damit pg-boss die Aufgabe später wiederholt.
 */
export async function deliverEvent(
  database: Database<unknown>,
  subscriber: Subscriber,
  payload: unknown,
): Promise<DeliveryResult> {
  const parsed = eventEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new EventDeliveryError(`${subscriber.name}: Ereignis hat keine gültige Hülle`);
  const { actor, ...rest } = parsed.data;
  const envelope: EventEnvelope = {
    ...rest,
    actor: actor.id === undefined ? { type: actor.type } : { type: actor.type, id: actor.id },
  };
  if (!subscribesTo(subscriber, envelope.type)) {
    throw new EventDeliveryError(`${subscriber.name}: hört nicht auf ${envelope.type}`);
  }
  if (envelope.tenantId === null) {
    // Die Inbox hat immer einen Shop. Plattform-Ereignisse bekommen ihre Subscriber erst mit Bedarf.
    throw new EventDeliveryError(`${subscriber.name}: Plattform-Ereignisse werden noch nicht zugestellt`);
  }
  let event = envelope;
  if (subscriber.events !== "*") {
    const definition = subscriber.events.find((e) => e.type === envelope.type);
    const data = definition?.schema.safeParse(envelope.data);
    if (data?.success !== true) {
      throw new EventDeliveryError(`${subscriber.name}: Daten von ${envelope.type} passen nicht zum Schema`);
    }
    event = { ...envelope, data: data.data };
  }
  const tenantId = envelope.tenantId;
  const inbox = sql.table(`${subscriber.schema}.processed_event`);
  return runWithContext(
    {
      requestId: uuidv7(),
      correlationId: envelope.correlationId,
      causationId: envelope.id,
      tenantId,
      actor: { type: "system" },
    },
    () =>
      withTenantTransaction(
        database,
        async (trx): Promise<DeliveryResult> => {
          // Wartet eine zweite Zustellung desselben Ereignisses gleichzeitig, blockiert sie hier,
          // bis die erste fertig ist, und findet dann den Eintrag (oder nach Rückrollen keinen).
          const { rows } = await sql<{ event_id: string }>`
            insert into ${inbox} (tenant_id, event_id, subscriber)
            values (kernel.current_tenant_id(), ${envelope.id}, ${subscriber.name})
            on conflict do nothing
            returning event_id`.execute(trx);
          if (rows.length === 0) return "duplicate";
          await subscriber.handle(trx, event);
          return "processed";
        },
        { tenantId, actorId: "" },
      ),
  );
}
