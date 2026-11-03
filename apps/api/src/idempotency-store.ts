// Ablage der Idempotenz-Schlüssel (Architektur 4.5). In Betrieb und Datenbanktests die Tabelle
// kernel.idempotency_key über den Kernel; in Tests ohne Datenbank eine Ablage im Arbeitsspeicher
// mit denselben Regeln.
import {
  abandonIdempotent,
  beginIdempotent,
  completeIdempotent,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
  type Database,
  type IdempotencyRequest,
  type IdempotencyStart,
} from "@shop/kernel";

export interface IdempotencyStore {
  begin(request: IdempotencyRequest): Promise<IdempotencyStart>;
  complete(
    request: Omit<IdempotencyRequest, "requestHash">,
    response: { status: number; body: unknown },
  ): Promise<void>;
  abandon(request: Omit<IdempotencyRequest, "requestHash">): Promise<void>;
}

export function databaseIdempotencyStore(database: Database<unknown>): IdempotencyStore {
  // Die Tabelle gehört dem Kernel; seine Typen liegen über dem gemeinsamen Griff.
  const db = database as Parameters<typeof beginIdempotent>[0];
  return {
    begin: (r) => beginIdempotent(db, r),
    complete: (r, response) => completeIdempotent(db, r, response),
    abandon: (r) => abandonIdempotent(db, r),
  };
}

/** Nur für Tests ohne Datenbank. */
export function memoryIdempotencyStore(): IdempotencyStore {
  const rows = new Map<string, { hash: Buffer; status?: number; body?: unknown }>();
  const id = (r: { tenantId: string; scope: string; key: string }) => `${r.tenantId}|${r.scope}|${r.key}`;
  return {
    async begin(r) {
      const row = rows.get(id(r));
      if (row === undefined) {
        rows.set(id(r), { hash: r.requestHash });
        return { kind: "new" };
      }
      if (!row.hash.equals(r.requestHash)) throw new IdempotencyKeyReusedError();
      if (row.status === undefined) throw new IdempotencyInProgressError();
      return { kind: "replay", status: row.status, body: row.body };
    },
    async complete(r, response) {
      const row = rows.get(id(r));
      if (row !== undefined) Object.assign(row, response);
    },
    async abandon(r) {
      if (rows.get(id(r))?.status === undefined) rows.delete(id(r));
    },
  };
}
