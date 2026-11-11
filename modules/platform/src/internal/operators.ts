// Betreiberkonten nachschlagen (E6 Teil 4, Architektur 4.3, Sicherheit 5.3). Liest drei Spalten von
// platform.platform_user als shop_app (nur lesen, Migration 20261107T090100). Damit entscheidet
// apps/api bei jeder Anfrage, ob ein Konto die Platform-API nutzen darf und ob die strengeren
// Sitzungsregeln gelten. Kein Zwischenspeicher: Ein deaktiviertes Betreiberkonto wirkt sofort.
import { isUuid, withPlatformTransaction, type Database } from "@shop/kernel";
import type { DB } from "../db.generated.js";

export const OPERATOR_ROLES = ["owner", "operator", "support", "viewer"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface Operator {
  readonly userId: string;
  readonly role: OperatorRole;
}

export interface OperatorDirectory {
  /** Aktives Betreiberkonto zu diesem Nutzer, sonst `undefined`. */
  findOperator(userId: string): Promise<Operator | undefined>;
}

export interface OperatorDirectoryOptions {
  /** Verbindung als Rolle shop_app (nur lesen). */
  readonly database: Database<unknown>;
}

function toRole(value: string): OperatorRole {
  if ((OPERATOR_ROLES as readonly string[]).includes(value)) return value as OperatorRole;
  throw new Error("Unbekannte Rolle in platform.platform_user");
}

export function createOperatorDirectory(options: OperatorDirectoryOptions): OperatorDirectory {
  const database = options.database as Database<DB>;
  return {
    async findOperator(userId) {
      if (!isUuid(userId)) return undefined;
      const row = await withPlatformTransaction(database, (trx) =>
        trx
          .selectFrom("platform.platform_user")
          .select(["user_id", "role"])
          .where("user_id", "=", userId)
          .where("status", "=", "active")
          .executeTakeFirst(),
      );
      return row === undefined ? undefined : { userId: row.user_id, role: toRole(row.role) };
    },
  };
}

/**
 * Betreiberkonto für Testdaten anlegen (M8, `pnpm dev:seed`). Verbindung als Rolle shop_platform.
 * Gibt es das Konto schon, bleibt es unverändert. Nicht für Produktion: Dort legt der Betrieb
 * Betreiberkonten bewusst von Hand an.
 */
export async function addOperatorForTestData(
  database: Database<unknown>,
  input: { readonly userId: string; readonly role: OperatorRole },
): Promise<void> {
  if (!isUuid(input.userId)) throw new RangeError("Ungültige Konto-Id");
  await withPlatformTransaction(database as Database<DB>, (trx) =>
    trx
      .insertInto("platform.platform_user")
      .values({ user_id: input.userId, role: input.role })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute(),
  );
}
