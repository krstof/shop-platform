// Shops verwalten (MVP-Etappe M1): anlegen, auflisten, sperren und wieder freischalten. Nur für die
// Plattform-Verwaltung. Schreibt die globalen Tabellen platform.merchant und platform.tenant und
// braucht dafür eine Verbindung als Rolle shop_platform (shop_app darf dort nur lesen).
//
// MVP-Vereinfachung: Je Shop entsteht ein eigener Händler-Eintrag mit dem Shopnamen; der Shop ist
// sofort `active` (kein Zwischenschritt `provisioning`). Die Inhaberin lädt apps/api über das Modul
// identity ein, sobald der Shop steht.
import { isUuid, withPlatformTransaction, type Database, type Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { TENANT_STATUSES, type TenantStatus } from "./shops.js";

/** Kurzname eines Shops: Kleinbuchstaben, Ziffern und Bindestriche, 3 bis 63 Zeichen (wie in der Tabelle). */
export const SHOP_HANDLE_PATTERN = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$/;

export interface ShopRecord {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly ownerEmail: string | null;
  readonly createdAt: Date;
}

export type CreateShopResult =
  { readonly ok: true; readonly shop: ShopRecord } | { readonly ok: false; readonly reason: "handle_taken" };

export type ChangeStatusResult =
  { readonly ok: true; readonly shop: ShopRecord } | { readonly ok: false; readonly reason: "not_found" };

export interface ShopAdministration {
  /** Alle Shops außer gelöschten, älteste zuerst, seitenweise (`afterId`: Cursor). Liefert bis `limit + 1`. */
  list(options: { readonly limit: number; readonly afterId?: string }): Promise<ShopRecord[]>;
  get(id: string): Promise<ShopRecord | undefined>;
  /** Shop mit eigenem Händler-Eintrag anlegen, sofort aktiv. */
  create(input: {
    readonly handle: string;
    readonly name: string;
    readonly ownerEmail: string;
    readonly actorId?: string;
  }): Promise<CreateShopResult>;
  /** Shop umbenennen (Einstellungen „Allgemein“ der Händlerin). */
  rename(input: { readonly id: string; readonly name: string; readonly actorId?: string }): Promise<boolean>;
  /** Sperren (`suspended`) oder wieder freischalten (`active`). Wirkt bei der nächsten Anfrage. */
  setStatus(input: {
    readonly id: string;
    readonly status: "active" | "suspended";
    readonly actorId?: string;
  }): Promise<ChangeStatusResult>;
}

export interface ShopAdministrationOptions {
  /** Verbindung als Rolle shop_platform. */
  readonly database: Database<unknown>;
}

const COLUMNS = ["t.id", "t.handle", "t.name", "t.status", "t.created_at", "m.contact_email"] as const;

interface Row {
  id: string;
  handle: string;
  name: string;
  status: string;
  created_at: Date;
  contact_email: string | null;
}

function toRecord(r: Row): ShopRecord {
  if (!(TENANT_STATUSES as readonly string[]).includes(r.status))
    throw new Error("Unbekannter Zustand eines Shops in platform.tenant");
  return {
    id: r.id,
    handle: r.handle,
    name: r.name,
    status: r.status as TenantStatus,
    ownerEmail: r.contact_email,
    createdAt: r.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createShopAdministration(options: ShopAdministrationOptions): ShopAdministration {
  const database = options.database as Database<DB>;
  const selectShops = (trx: Transaction<DB>) =>
    trx
      .selectFrom("platform.tenant as t")
      .innerJoin("platform.merchant as m", "m.id", "t.merchant_id")
      .select(COLUMNS);

  const get = async (id: string): Promise<ShopRecord | undefined> => {
    if (!isUuid(id)) return undefined;
    const row = await withPlatformTransaction(database, (trx) =>
      selectShops(trx).where("t.id", "=", id).where("t.status", "!=", "deleted").executeTakeFirst(),
    );
    return row === undefined ? undefined : toRecord(row);
  };

  return {
    async list({ limit, afterId }) {
      const rows = await withPlatformTransaction(database, (trx) => {
        let q = selectShops(trx)
          .where("t.status", "!=", "deleted")
          .orderBy("t.id", "asc")
          .limit(limit + 1);
        if (afterId !== undefined) q = q.where("t.id", ">", afterId);
        return q.execute();
      });
      return rows.map(toRecord);
    },

    get,

    async create(input) {
      const handle = input.handle.trim().toLowerCase();
      if (!SHOP_HANDLE_PATTERN.test(handle)) throw new RangeError("Ungültiger Kurzname");
      try {
        const row = await withPlatformTransaction(
          database,
          async (trx) => {
            const plan = await trx
              .selectFrom("platform.plan")
              .select("id")
              .where("is_default", "=", true)
              .executeTakeFirstOrThrow();
            const merchant = await trx
              .insertInto("platform.merchant")
              .values({ name: input.name, contact_email: input.ownerEmail.trim().toLowerCase() })
              .returning("id")
              .executeTakeFirstOrThrow();
            const tenant = await trx
              .insertInto("platform.tenant")
              .values({
                merchant_id: merchant.id,
                plan_id: plan.id,
                handle,
                name: input.name,
                status: "active",
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            return selectShops(trx).where("t.id", "=", tenant.id).executeTakeFirstOrThrow();
          },
          input.actorId === undefined ? {} : { actorId: input.actorId },
        );
        return { ok: true, shop: toRecord(row) };
      } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, reason: "handle_taken" };
        throw error;
      }
    },

    async rename(input) {
      if (!isUuid(input.id)) return false;
      const name = input.name.trim();
      if (name === "" || name.length > 100) throw new RangeError("Ungültiger Name");
      const row = await withPlatformTransaction(
        database,
        (trx) =>
          trx
            .updateTable("platform.tenant")
            .set({ name })
            .where("id", "=", input.id)
            .where("status", "in", ["active", "suspended"])
            .returning("id")
            .executeTakeFirst(),
        input.actorId === undefined ? {} : { actorId: input.actorId },
      );
      return row !== undefined;
    },

    async setStatus(input) {
      if (!isUuid(input.id)) return { ok: false, reason: "not_found" };
      const row = await withPlatformTransaction(
        database,
        async (trx) => {
          const updated = await trx
            .updateTable("platform.tenant")
            .set(
              input.status === "suspended"
                ? { status: "suspended", suspended_at: new Date() }
                : { status: "active", suspended_at: null, suspended_reason: null },
            )
            .where("id", "=", input.id)
            .where("status", "in", ["active", "suspended"])
            .returning("id")
            .executeTakeFirst();
          if (updated === undefined) return undefined;
          return selectShops(trx).where("t.id", "=", updated.id).executeTakeFirstOrThrow();
        },
        input.actorId === undefined ? {} : { actorId: input.actorId },
      );
      return row === undefined ? { ok: false, reason: "not_found" } : { ok: true, shop: toRecord(row) };
    },
  };
}
