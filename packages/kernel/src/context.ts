// Anfrage-Kontext (Architektur 5.3): Mandant, Akteur und requestId hängen an der
// laufenden Anfrage, ohne durch jede Funktion gereicht zu werden.
import { AsyncLocalStorage } from "node:async_hooks";

export const ACTOR_TYPES = ["user", "api_token", "ai", "app", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface Actor {
  readonly type: ActorType;
  /** ID des Nutzers, Tokens oder der App. Beim System leer. */
  readonly id?: string;
}

export interface RequestContext {
  readonly requestId: string;
  /** Verbindet alle Schritte eines Vorgangs, auch über Hintergrundjobs hinweg. */
  readonly correlationId?: string;
  /** Ereignis, das gerade verarbeitet wird. Folgeereignisse tragen es als `causationId`. */
  readonly causationId?: string;
  readonly tenantId?: string;
  readonly actor?: Actor;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(Object.freeze({ ...context }), fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}
