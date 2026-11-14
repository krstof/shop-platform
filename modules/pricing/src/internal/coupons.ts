// Gutscheine in pricing.coupon. Läuft immer in withTenantTransaction (RLS).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import type { Coupon } from "./coupon-rules.js";

type Row = {
  id: string;
  code: string;
  kind: string;
  value: string | number | bigint;
  min_order_amount: string | number | bigint | null;
  active: boolean;
};

const toCoupon = (r: Row): Coupon => ({
  id: r.id,
  code: r.code,
  kind: r.kind === "amount" ? "amount" : "percent",
  value: Number(r.value),
  minOrderAmount: r.min_order_amount === null ? null : Number(r.min_order_amount),
  active: r.active,
});

const COLUMNS = ["id", "code", "kind", "value", "min_order_amount", "active"] as const;

export async function listCoupons(trx: Transaction<DB>): Promise<Coupon[]> {
  return (await trx.selectFrom("pricing.coupon").select(COLUMNS).orderBy("code").limit(500).execute()).map(
    toCoupon,
  );
}

export async function findCouponByCode(trx: Transaction<DB>, code: string): Promise<Coupon | undefined> {
  const r = await trx
    .selectFrom("pricing.coupon")
    .select(COLUMNS)
    .where("code", "=", code)
    .executeTakeFirst();
  return r === undefined ? undefined : toCoupon(r);
}

export async function insertCoupon(
  trx: Transaction<DB>,
  tenantId: string,
  c: Omit<Coupon, "id">,
): Promise<Coupon | "duplicate"> {
  const r = await trx
    .insertInto("pricing.coupon")
    .values({
      tenant_id: tenantId,
      code: c.code,
      kind: c.kind,
      value: c.value,
      min_order_amount: c.minOrderAmount,
      active: c.active,
    })
    .onConflict((oc) => oc.columns(["tenant_id", "code"]).doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
  return r === undefined ? "duplicate" : toCoupon(r);
}

export async function setCouponActive(
  trx: Transaction<DB>,
  id: string,
  active: boolean,
): Promise<Coupon | undefined> {
  const r = await trx
    .updateTable("pricing.coupon")
    .set((eb) => ({ active, updated_at: new Date(), version: eb("version", "+", 1) }))
    .where("id", "=", id)
    .returning(COLUMNS)
    .executeTakeFirst();
  return r === undefined ? undefined : toCoupon(r);
}

export async function deleteCoupon(trx: Transaction<DB>, id: string): Promise<boolean> {
  const r = await trx.deleteFrom("pricing.coupon").where("id", "=", id).executeTakeFirst();
  return r.numDeletedRows > 0n;
}
