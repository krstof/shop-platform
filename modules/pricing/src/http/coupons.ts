// Gutscheincodes in der Admin-API: auflisten, anlegen, an- und abschalten, löschen.
// Einlösen passiert im Warenkorb (Modul checkout über die Fassade).
import { defineEndpoint, idParam, type Endpoint } from "@shop/http";
import {
  ConflictError,
  getContext,
  NotFoundError,
  ValidationError,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";
import { normalizeCode, type Coupon } from "../internal/coupon-rules.js";
import { deleteCoupon, insertCoupon, listCoupons, setCouponActive } from "../internal/coupons.js";

const couponSchema = z
  .object({
    id: z.uuid(),
    code: z.string().meta({ description: "Code in Großbuchstaben, etwa `SOMMER10`." }),
    kind: z
      .enum(["percent", "amount"])
      .meta({ description: "`percent` = Prozent, `amount` = fester Betrag." }),
    value: z.number().int().meta({ description: "Prozent (1 bis 100) oder Betrag in Cent." }),
    minOrderAmount: z.number().int().nullable().meta({ description: "Mindestwarenwert in Cent oder null." }),
    active: z.boolean(),
  })
  .meta({ id: "Coupon", description: "Gutscheincode für Rabatt auf den Warenwert." });

const createInput = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(40)
    .meta({ description: "2 bis 32 Zeichen: Buchstaben, Ziffern, Bindestrich." }),
  kind: z.enum(["percent", "amount"]),
  value: z.number().int().min(1).max(100_000_000),
  minOrderAmount: z.number().int().min(1).max(100_000_000).nullable().optional(),
});

const TEXT = {
  code: "Der Code darf nur Buchstaben, Ziffern und Bindestriche haben (2 bis 32 Zeichen).",
  percent: "Prozent bitte zwischen 1 und 100.",
  duplicate: "Diesen Code gibt es schon.",
};

const toJson = (c: Coupon) => ({ ...c });

export function couponEndpoints(deps: { readonly database: Database<unknown> }): Endpoint[] {
  const db = deps.database as Database<DB>;
  const access = {
    read: { scopes: ["products:read"] as const },
    write: { scopes: ["products:write"] as const },
  };

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/coupons",
    operationId: "listCoupons",
    summary: "Gutscheine auflisten",
    description: "Alle Gutscheincodes des Shops, nach Code sortiert (höchstens 500).",
    tags: ["Gutscheine"],
    access: access.read,
    response: {
      status: 200,
      description: "Die Gutscheine.",
      schema: z.object({ data: z.array(couponSchema) }),
    },
    handler: async () => ({ data: (await withTenantTransaction(db, listCoupons)).map(toJson) }),
  });

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/coupons",
    operationId: "createCoupon",
    summary: "Gutschein anlegen",
    description:
      "Legt einen Gutscheincode an (gleich aktiv). Der Code wird in Großbuchstaben gespeichert; " +
      "Kundinnen dürfen ihn klein schreiben. Gibt es den Code schon: 409.",
    tags: ["Gutscheine"],
    access: access.write,
    body: createInput,
    bodyExample: { code: "SOMMER10", kind: "percent", value: 10 },
    response: { status: 201, description: "Der neue Gutschein.", schema: couponSchema },
    problems: [409],
    handler: async ({ body }) => {
      const code = normalizeCode(body.code);
      if (code === undefined)
        throw new ValidationError({
          errors: [{ path: "/body/code", code: "invalid_code", message: TEXT.code }],
        });
      if (body.kind === "percent" && body.value > 100)
        throw new ValidationError({
          errors: [{ path: "/body/value", code: "percent_too_high", message: TEXT.percent }],
        });
      const tenantId = getContext()?.tenantId ?? "";
      const r = await withTenantTransaction(db, (trx) =>
        insertCoupon(trx, tenantId, {
          code,
          kind: body.kind,
          value: body.value,
          minOrderAmount: body.minOrderAmount ?? null,
          active: true,
        }),
      );
      if (r === "duplicate") throw new ConflictError({ detail: TEXT.duplicate });
      return toJson(r);
    },
  });

  const update = defineEndpoint({
    api: "admin",
    method: "PATCH",
    path: "/coupons/{couponId}",
    operationId: "updateCoupon",
    summary: "Gutschein an- oder abschalten",
    description: "Schaltet einen Gutschein an oder ab. Abgeschaltete Codes gelten in keinem Warenkorb mehr.",
    tags: ["Gutscheine"],
    access: access.write,
    params: z.strictObject({ couponId: idParam }),
    body: z.strictObject({ active: z.boolean() }),
    bodyExample: { active: false },
    response: { status: 200, description: "Der Gutschein danach.", schema: couponSchema },
    problems: [404],
    handler: async ({ params, body }) => {
      const c = await withTenantTransaction(db, (trx) => setCouponActive(trx, params.couponId, body.active));
      if (c === undefined) throw new NotFoundError();
      return toJson(c);
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/coupons/{couponId}",
    operationId: "deleteCoupon",
    summary: "Gutschein löschen",
    description: "Löscht einen Gutschein. Bestellungen, die ihn genutzt haben, behalten ihren Rabatt.",
    tags: ["Gutscheine"],
    access: access.write,
    params: z.strictObject({ couponId: idParam }),
    response: {
      status: 200,
      description: "Gelöscht.",
      schema: z.object({ id: z.uuid(), deleted: z.literal(true) }).meta({ id: "DeletedCoupon" }),
    },
    problems: [404],
    handler: async ({ params }) => {
      if (!(await withTenantTransaction(db, (trx) => deleteCoupon(trx, params.couponId))))
        throw new NotFoundError();
      return { id: params.couponId, deleted: true as const };
    },
  });

  return [list, create, update, remove];
}
