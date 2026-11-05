// EINZIGE öffentliche Datei des Moduls audit (Architektur 3.3, Regel 3).
// audit ruft kein anderes Modul auf; es hört auf alle Ereignisse (Subscriber audit.record).
import type { Endpoint } from "@shop/http";
import type { Database, Subscriber } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { auditEndpoints as endpoints } from "./http/admin/audit-entries.js";
import { recordSubscriber } from "./record.subscriber.js";

export type { AuditEntry } from "./http/admin/audit-entries.js";

export interface AuditDependencies {
  /** Verbindung als Rolle shop_app. Der Zugriff läuft ausschließlich über withTenantTransaction. */
  readonly database: Database<unknown>;
}

/** HTTP-Endpunkte des Moduls (Admin-API). */
export function auditEndpoints(deps: AuditDependencies): Endpoint[] {
  return endpoints(deps.database as Database<DB>);
}

/** Subscriber des Moduls; der Dienst worker stellt ihnen die Ereignisse zu. */
export function auditSubscribers(): Subscriber[] {
  return [recordSubscriber];
}
