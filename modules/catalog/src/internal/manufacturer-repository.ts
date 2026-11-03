// Datenzugriff für Hersteller. Läuft immer in einer Transaktion aus withTenantTransaction:
// Die RLS-Regel der Datenbank liefert nur Zeilen des Shops aus dem Anfrage-Kontext.
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";

const TABLE = "catalog.manufacturer";

const COLUMNS = [
  "id",
  "name",
  "trade_name",
  "address_line1",
  "address_line2",
  "postal_code",
  "city",
  "country_code",
  "email",
  "website_url",
  "eu_responsible_name",
  "eu_responsible_address",
  "eu_responsible_email",
  "eu_responsible_phone",
  "archived_at",
  "created_at",
  "updated_at",
  "version",
] as const;

export interface ManufacturerRow {
  id: string;
  name: string;
  trade_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string | null;
  email: string | null;
  website_url: string | null;
  eu_responsible_name: string | null;
  eu_responsible_address: string | null;
  eu_responsible_email: string | null;
  eu_responsible_phone: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

/**
 * Nicht archivierte Hersteller in Anlagereihenfolge (UUIDv7 ist zeitlich sortiert), ab einem Cursor.
 * Liest eine Zeile mehr als verlangt, damit der Aufrufer weiß, ob es eine nächste Seite gibt.
 */
export async function findManufacturers(
  trx: Transaction<DB>,
  options: { readonly limit: number; readonly afterId?: string | undefined },
): Promise<ManufacturerRow[]> {
  let query = trx
    .selectFrom(TABLE)
    .select(COLUMNS)
    .where("archived_at", "is", null)
    .orderBy("id")
    .limit(options.limit + 1);
  if (options.afterId !== undefined) query = query.where("id", ">", options.afterId);
  return query.execute();
}

/** Ein Hersteller des eigenen Shops, auch archiviert. Fremde IDs ergeben `undefined` (RLS). */
export async function findManufacturerById(
  trx: Transaction<DB>,
  id: string,
): Promise<ManufacturerRow | undefined> {
  return trx.selectFrom(TABLE).select(COLUMNS).where("id", "=", id).executeTakeFirst();
}

/** Spalten, die beim Anlegen und Ändern gesetzt werden dürfen. Mandant, ID und Version nie. */
export interface ManufacturerChanges {
  name?: string;
  trade_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string | null;
  email?: string | null;
  website_url?: string | null;
  eu_responsible_name?: string | null;
  eu_responsible_address?: string | null;
  eu_responsible_email?: string | null;
  eu_responsible_phone?: string | null;
}

export async function insertManufacturer(
  trx: Transaction<DB>,
  tenantId: string,
  values: ManufacturerChanges & { name: string },
): Promise<ManufacturerRow> {
  return trx
    .insertInto(TABLE)
    .values({ ...values, tenant_id: tenantId })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
}

export type UpdateResult =
  | { readonly kind: "updated"; readonly row: ManufacturerRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_mismatch" };

/**
 * Ändert nur, wenn die Version noch stimmt (Architektur 4.6). Die Version zählt der Trigger
 * kernel.tg_touch_row hoch. Fremde IDs sind wegen der RLS „nicht gefunden“.
 */
export async function updateManufacturer(
  trx: Transaction<DB>,
  id: string,
  expectedVersion: number,
  changes: ManufacturerChanges,
): Promise<UpdateResult> {
  // Nichts zu ändern (zum Beispiel nur ein leeres address-Objekt): Version trotzdem prüfen.
  const row =
    Object.keys(changes).length === 0
      ? await trx
          .selectFrom(TABLE)
          .select(COLUMNS)
          .where("id", "=", id)
          .where("version", "=", expectedVersion)
          .executeTakeFirst()
      : await trx
          .updateTable(TABLE)
          .set(changes)
          .where("id", "=", id)
          .where("version", "=", expectedVersion)
          .returning(COLUMNS)
          .executeTakeFirst();
  if (row !== undefined) return { kind: "updated", row };
  const exists = await trx.selectFrom(TABLE).select("id").where("id", "=", id).executeTakeFirst();
  return exists === undefined ? { kind: "not_found" } : { kind: "version_mismatch" };
}
