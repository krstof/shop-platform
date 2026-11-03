// Idempotenz-Schlüssel (Architektur 4.5): Wiederholt ein Aufrufer eine POST-Anfrage mit demselben
// `Idempotency-Key`, bekommt er die gespeicherte Antwort, statt dass etwas doppelt passiert.
// Eine andere Anfrage mit demselben Schlüssel wird abgelehnt. Schlüssel gelten 24 Stunden.
//
// Ablauf in drei kurzen Transaktionen, jeweils für genau einen Mandanten (RLS):
//   1. beginIdempotent: Zeile „in Arbeit“ anlegen. Gibt es sie schon: gleiche Anfrage und fertig
//      → Antwort wiederholen; gleiche Anfrage und noch in Arbeit → 409; andere Anfrage → 422.
//   2. Der Endpunkt arbeitet in seiner eigenen Transaktion.
//   3. completeIdempotent speichert die Antwort, abandonIdempotent löscht die Zeile nach einem Fehler,
//      damit der Aufrufer es erneut versuchen kann.
// Bleibt eine Zeile „in Arbeit“ hängen (Absturz zwischen 2 und 3), gilt sie nach 60 Sekunden als
// verlassen und darf neu übernommen werden.
import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { DB } from "../db.generated.js";
import { AppError } from "../problem.js";
import { withTenantTransaction, type Database } from "./database.js";

const TABLE = "kernel.idempotency_key";
const STALE_IN_PROGRESS_SECONDS = 60;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;

export interface IdempotencyRequest {
  readonly tenantId: string;
  /** Wofür der Schlüssel gilt, zum Beispiel `admin:createManufacturer`. */
  readonly scope: string;
  readonly key: string;
  /** Fingerabdruck der Anfrage, siehe `requestFingerprint`. */
  readonly requestHash: Buffer;
}

export type IdempotencyStart =
  | { readonly kind: "new" }
  | { readonly kind: "replay"; readonly status: number; readonly body: unknown };

/** SHA-256 über Akteur, Methode, Pfad und Inhalt in fester Reihenfolge der Felder. */
export function requestFingerprint(parts: {
  readonly actorId: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}): Buffer {
  return createHash("sha256")
    .update(JSON.stringify([parts.actorId, parts.method, parts.path, canonical(parts.body)]))
    .digest();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export class IdempotencyKeyReusedError extends AppError {
  readonly status = 422;
  readonly code = "idempotency_key_reused";
  readonly title = "Der Idempotency-Key gehört zu einer anderen Anfrage.";
}

export class IdempotencyInProgressError extends AppError {
  readonly status = 409;
  readonly code = "idempotency_in_progress";
  readonly title = "Die Anfrage wird noch bearbeitet.";
}

export async function beginIdempotent(
  database: Database<DB>,
  request: IdempotencyRequest,
): Promise<IdempotencyStart> {
  return withTenantTransaction(
    database,
    async (trx) => {
      // Abgelaufene und verlassene Einträge zu diesem Schlüssel zuerst entfernen.
      await trx
        .deleteFrom(TABLE)
        .where("scope", "=", request.scope)
        .where("key", "=", request.key)
        .where((eb) =>
          eb.or([
            eb("expires_at", "<", sql<Date>`now()`),
            eb.and([
              eb("status", "=", "in_progress"),
              eb("created_at", "<", sql<Date>`now() - make_interval(secs => ${STALE_IN_PROGRESS_SECONDS})`),
            ]),
          ]),
        )
        .execute();
      const inserted = await trx
        .insertInto(TABLE)
        .values({
          tenant_id: request.tenantId,
          scope: request.scope,
          key: request.key,
          request_hash: request.requestHash,
        })
        .onConflict((oc) => oc.columns(["tenant_id", "scope", "key"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (inserted !== undefined) return { kind: "new" };

      const existing = await trx
        .selectFrom(TABLE)
        .select(["request_hash", "status", "response_status", "response_body"])
        .where("scope", "=", request.scope)
        .where("key", "=", request.key)
        .executeTakeFirstOrThrow();
      if (!Buffer.from(existing.request_hash).equals(request.requestHash)) {
        throw new IdempotencyKeyReusedError({
          detail: "Dieser Idempotency-Key wurde schon für eine andere Anfrage benutzt.",
          errors: [
            {
              path: "/headers/idempotency-key",
              code: "idempotency_key_reused",
              message: "Bitte für jede neue Anfrage einen neuen Schlüssel verwenden.",
            },
          ],
        });
      }
      if (existing.status !== "completed" || existing.response_status === null) {
        throw new IdempotencyInProgressError({
          detail: "Die erste Anfrage mit diesem Schlüssel wird noch bearbeitet. Bitte kurz warten.",
        });
      }
      return { kind: "replay", status: existing.response_status, body: existing.response_body };
    },
    { tenantId: request.tenantId },
  );
}

export async function completeIdempotent(
  database: Database<DB>,
  request: Omit<IdempotencyRequest, "requestHash">,
  response: { readonly status: number; readonly body: unknown },
): Promise<void> {
  await withTenantTransaction(
    database,
    (trx) =>
      trx
        .updateTable(TABLE)
        .set({
          status: "completed",
          response_status: response.status,
          response_body: JSON.stringify(response.body),
        })
        .where("scope", "=", request.scope)
        .where("key", "=", request.key)
        .execute(),
    { tenantId: request.tenantId },
  );
}

export async function abandonIdempotent(
  database: Database<DB>,
  request: Omit<IdempotencyRequest, "requestHash">,
): Promise<void> {
  await withTenantTransaction(
    database,
    (trx) =>
      trx
        .deleteFrom(TABLE)
        .where("scope", "=", request.scope)
        .where("key", "=", request.key)
        .where("status", "=", "in_progress")
        .execute(),
    { tenantId: request.tenantId },
  );
}
