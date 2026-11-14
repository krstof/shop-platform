// Versandkosten in der Admin-API (lesen, ändern) und in der Storefront-API (lesen, für Hinweise
// wie „zzgl. 4,90 € Versand, ab 50 € versandkostenfrei“).
import { defineEndpoint, type Endpoint } from "@shop/http";
import {
  getContext,
  NotFoundError,
  ValidationError,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";
import { readStandard, writeStandard } from "../internal/standard.js";

const shippingSchema = z
  .object({
    amount: z.number().int().meta({ description: "Pauschale brutto in Cent; 0 = Versand immer kostenlos." }),
    freeFrom: z
      .number()
      .int()
      .nullable()
      .meta({ description: "Ab diesem Warenwert (brutto, Cent) kostenlos; null = keine Grenze." }),
    currency: z.literal("EUR"),
  })
  .meta({
    id: "ShippingSettings",
    description: "Standardversand: Pauschale und Grenze für kostenlosen Versand.",
  });

const input = z.strictObject({
  amount: z.number().int().min(0).max(100_000).meta({ description: "Pauschale in Cent, höchstens 1.000 €." }),
  freeFrom: z
    .number()
    .int()
    .min(1)
    .max(100_000_000)
    .nullable()
    .meta({ description: "Grenze in Cent oder null." }),
});

const FREE_FROM_USELESS = "Bei 0 € Versand braucht es keine Grenze für kostenlosen Versand.";

export function shippingEndpoints(deps: { readonly database: Database<unknown> }): Endpoint[] {
  const db = deps.database as Database<DB>;
  const view = async () => ({ ...(await withTenantTransaction(db, readStandard)), currency: "EUR" as const });

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/shipping",
    operationId: "getShipping",
    summary: "Versandkosten lesen",
    description: "Pauschale und Grenze für kostenlosen Versand. Ohne Einstellung: Versand kostenlos.",
    tags: ["Versand"],
    access: { scopes: ["settings:read"] },
    response: { status: 200, description: "Die Versandkosten.", schema: shippingSchema },
    handler: view,
  });

  const put = defineEndpoint({
    api: "admin",
    method: "PUT",
    path: "/shipping",
    operationId: "updateShipping",
    summary: "Versandkosten ändern",
    description:
      "Setzt die Pauschale (brutto, für Deutschland) und wahlweise die Grenze, ab der der Versand " +
      "kostenlos ist. Gilt sofort für Warenkörbe und neue Bestellungen; bestehende Bestellungen bleiben.",
    tags: ["Versand"],
    access: { scopes: ["settings:write"] },
    body: input,
    bodyExample: { amount: 490, freeFrom: 5000 },
    response: { status: 200, description: "Die neuen Versandkosten.", schema: shippingSchema },
    handler: async ({ body }) => {
      if (body.amount === 0 && body.freeFrom !== null)
        throw new ValidationError({
          detail: FREE_FROM_USELESS,
          errors: [{ path: "/body/freeFrom", code: "free_from_without_amount", message: FREE_FROM_USELESS }],
        });
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, (trx) => writeStandard(trx, tenantId, body));
      return view();
    },
  });

  const store = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/shipping",
    operationId: "getStoreShipping",
    summary: "Versandkosten des Shops",
    description: "Pauschale und Grenze für kostenlosen Versand, für Hinweise im Shop.",
    tags: ["Storefront"],
    access: { public: true, reason: "Jeder Besucher muss die Versandkosten vor dem Kauf sehen." },
    params: z.strictObject({
      shopHandle: z
        .string()
        .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
        .meta({ description: "Kürzel des Shops, etwa `teeladen`." }),
    }),
    response: { status: 200, description: "Die Versandkosten.", schema: shippingSchema },
    problems: [404],
    handler: async () => {
      if (getContext()?.tenantId === undefined) throw new NotFoundError();
      return view();
    },
  });

  return [get, put, store];
}
