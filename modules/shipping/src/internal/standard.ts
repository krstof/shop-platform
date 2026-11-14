// Speichert die Standard-Versandart in shipping.shipping_method (code „standard“) mit einer
// Pauschale in shipping.shipping_rate (alle Länder, EUR). Läuft immer in withTenantTransaction.
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { FREE_SHIPPING, type StandardShipping } from "./rules.js";

const CODE = "standard";
const CURRENCY = "EUR";

export async function readStandard(trx: Transaction<DB>): Promise<StandardShipping> {
  const row = await trx
    .selectFrom("shipping.shipping_method as m")
    .leftJoin("shipping.shipping_rate as r", (j) =>
      j
        .onRef("r.shipping_method_id", "=", "m.id")
        .on("r.zone_id", "is", null)
        .on("r.currency", "=", CURRENCY),
    )
    .select(["m.free_shipping_threshold_amount as freeFrom", "r.amount"])
    .where("m.code", "=", CODE)
    .where("m.status", "=", "active")
    .executeTakeFirst();
  if (row === undefined) return FREE_SHIPPING;
  return {
    amount: row.amount === null ? 0 : Number(row.amount),
    freeFrom: row.freeFrom === null ? null : Number(row.freeFrom),
  };
}

export async function writeStandard(
  trx: Transaction<DB>,
  tenantId: string,
  s: StandardShipping,
): Promise<void> {
  const threshold = {
    free_shipping_threshold_amount: s.freeFrom,
    free_shipping_threshold_currency: s.freeFrom === null ? null : CURRENCY,
  };
  const existing = await trx
    .selectFrom("shipping.shipping_method")
    .select("id")
    .where("code", "=", CODE)
    .forUpdate()
    .executeTakeFirst();
  let id: string;
  if (existing === undefined) {
    id = (
      await trx
        .insertInto("shipping.shipping_method")
        .values({
          tenant_id: tenantId,
          code: CODE,
          kind: "delivery",
          rate_type: "flat",
          status: "active",
          ...threshold,
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
    await trx
      .insertInto("shipping.shipping_method_translation")
      .values({ tenant_id: tenantId, shipping_method_id: id, locale: "de", name: "Standardversand" })
      .execute();
  } else {
    id = existing.id;
    await trx
      .updateTable("shipping.shipping_method")
      .set({ ...threshold, status: "active" })
      .where("id", "=", id)
      .execute();
  }
  await trx
    .deleteFrom("shipping.shipping_rate")
    .where("shipping_method_id", "=", id)
    .where("zone_id", "is", null)
    .where("currency", "=", CURRENCY)
    .execute();
  await trx
    .insertInto("shipping.shipping_rate")
    .values({
      tenant_id: tenantId,
      shipping_method_id: id,
      currency: CURRENCY,
      amount: s.amount,
      tax_included: true,
    })
    .execute();
}
