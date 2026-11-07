// Mitgliedschaften: Wer gehört mit welcher Rolle zu welchem Shop (E6 Teil 3, SIC-03).
// Läuft als shop_app (nicht als shop_auth, ADR-008): identity.membership ist eine Mandantentabelle.
// Vor der Shop-Auswahl ist noch kein Mandant bekannt; die RLS-Regel lässt dann über
// `kernel.current_user_id()` genau die eigenen Mitgliedschaften durch (withUserTransaction).
import { isUuid, withUserTransaction, type Database } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { isSystemRole, type SystemRole } from "./roles.js";

export interface Membership {
  readonly tenantId: string;
  readonly role: SystemRole;
}

export interface MembershipDirectory {
  /**
   * Aktive Mitgliedschaften eines Kontos, sortiert nach Beitritt. Eingeladene und deaktivierte
   * Mitgliedschaften, eigene Rollen (erst Welle 5) und deaktivierte Konten zählen nicht.
   */
  listMemberships(userId: string): Promise<readonly Membership[]>;
  /** Eine aktive Mitgliedschaft in genau diesem Shop, sonst `undefined`. */
  findMembership(userId: string, tenantId: string): Promise<Membership | undefined>;
}

export interface MembershipDirectoryOptions {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
}

export function createMembershipDirectory(options: MembershipDirectoryOptions): MembershipDirectory {
  const database = options.database as Database<DB>;

  const query = (userId: string, tenantId: string | undefined) =>
    withUserTransaction(database, userId, (trx) => {
      let q = trx
        .selectFrom("identity.membership as m")
        .innerJoin("identity.user as u", "u.id", "m.user_id")
        .select(["m.tenant_id", "m.role_key"])
        .where("m.user_id", "=", userId)
        .where("m.status", "=", "active")
        .where("u.status", "=", "active");
      if (tenantId !== undefined) q = q.where("m.tenant_id", "=", tenantId);
      return q.orderBy("m.created_at").orderBy("m.tenant_id").execute();
    });

  const toMemberships = (rows: readonly { tenant_id: string; role_key: string }[]): Membership[] =>
    rows.flatMap((r) => (isSystemRole(r.role_key) ? [{ tenantId: r.tenant_id, role: r.role_key }] : []));

  return {
    async listMemberships(userId) {
      return toMemberships(await query(userId, undefined));
    },
    async findMembership(userId, tenantId) {
      if (!isUuid(tenantId)) return undefined;
      return toMemberships(await query(userId, tenantId))[0];
    },
  };
}
