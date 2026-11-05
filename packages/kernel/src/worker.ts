// Schnittstelle für den Dienst worker (`@shop/kernel/worker`, Etappe E5): Warteschlange, Relay,
// Zustellung an Subscriber und Aufräumen. Module brauchen das nicht; sie beschreiben Ereignisse
// und Subscriber über `@shop/kernel` (defineEvent, publishEvent, defineSubscriber).
export {
  DEFAULT_QUEUE_OPTIONS,
  expectedJobSchemaVersion,
  JOB_BATCH_SIZE,
  JOB_SCHEMA,
  JobSchemaMismatchError,
  startJobQueue,
  type JobQueue,
  type JobQueueOptions,
} from "./jobs/queue.js";
export {
  relayOutboxOnce,
  startRelay,
  type RelayOptions,
  type RelayResult,
  type RunningRelay,
  type StartRelayOptions,
} from "./events/relay.js";
export { deliverEvent, EventDeliveryError, type DeliveryResult } from "./events/subscriber.js";
export { cleanupExpired, type CleanupResult, type CleanupOptions } from "./jobs/cleanup.js";
