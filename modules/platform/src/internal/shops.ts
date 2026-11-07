// Shops nachschlagen (Fassade „getTenant“, Architektur 3.2). Liest die globale Tabelle
// platform.tenant (ohne RLS, db/global-tables.yaml) als shop_app; diese Rolle darf dort nur lesen.
import { isUuid, withPlatformTransaction, type Database } from "@shop/kernel";
import type { DB } from "../db.generated.js";

export const TENANT_STATUSES = ["provisioning", "active", "suspended", "deleting", "deleted"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface ShopSummary {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly status: TenantStatus;
}

export interface ShopDirectory {
  /** Shops zu diesen Kennungen, in derselben Reihenfolge. Unbekannte fehlen einfach. */
  getShops(ids: readonly string[]): Promise<readonly ShopSummary[]>;
}

export interface ShopDirectoryOptions {
  /** Verbindung als Rolle shop_app (nur lesen). */
  readonly database: Database<unknown>;
}

/** Höchstzahl je Abfrage; mehr Shops je Konto sind in Welle 1 nicht vorgesehen. */
export const MAX_SHOPS_PER_LOOKUP = 100;

function toStatus(value: string): TenantStatus {
  if ((TENANT_STATUSES as readonly string[]).includes(value)) return value as TenantStatus;
  throw new Error("Unbekannter Zustand eines Shops in platform.tenant");
}

export function createShopDirectory(options: ShopDirectoryOptions): ShopDirectory {
  const database = options.database as Database<DB>;
  return {
    async getShops(ids) {
      const wanted = [...new Set(ids.filter(isUuid))];
      if (wanted.length === 0) return [];
      if (wanted.length > MAX_SHOPS_PER_LOOKUP) throw new RangeError("Zu viele Shops in einer Abfrage");
      const rows = await withPlatformTransaction(database, (trx) =>
        trx
          .selectFrom("platform.tenant")
          .select(["id", "handle", "name", "status"])
          .where("id", "in", wanted)
          .execute(),
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      return wanted.flatMap((id) => {
        const r = byId.get(id);
        return r === undefined
          ? []
          : [{ id: r.id, handle: r.handle, name: r.name, status: toStatus(r.status) }];
      });
    },
  };
}
