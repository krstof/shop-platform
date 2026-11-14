// Bestseller für die Storefront (14.11.2026): die meistverkauften Produkte der letzten 90 Tage
// (Stückzahl aus bezahlten oder laufenden Bestellungen, ohne stornierte und unbezahlte). Liefert nur
// Produkt-IDs; Namen, Preise und Sichtbarkeit holt der Shop aus dem Katalog.
import { defineEndpoint, type Endpoint } from "@shop/http";
import { getContext, NotFoundError, withTenantTransaction, type Database } from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";

export const BESTSELLER_DAYS = 90;
export const BESTSELLER_LIMIT = 12;

export function bestsellerEndpoints(database: Database<unknown>): Endpoint[] {
  const db = database as Database<DB>;
  return [
    defineEndpoint({
      api: "store",
      method: "GET",
      path: "/shops/{shopHandle}/bestsellers",
      operationId: "getStoreBestsellers",
      summary: "Bestseller des Shops",
      description:
        `Die meistverkauften Produkte der letzten ${BESTSELLER_DAYS} Tage (höchstens ${BESTSELLER_LIMIT}), ` +
        "nach verkaufter Stückzahl. Nur IDs; nicht mehr sichtbare Produkte lässt der Shop weg.",
      tags: ["Storefront"],
      access: { public: true, reason: "Bestseller zeigt der Shop jedem Besucher." },
      params: z.strictObject({
        shopHandle: z
          .string()
          .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
          .meta({ description: "Kürzel des Shops, etwa `teeladen`." }),
      }),
      response: {
        status: 200,
        description: "Die Bestseller.",
        schema: z
          .object({ productIds: z.array(z.uuid()).max(BESTSELLER_LIMIT) })
          .meta({ id: "StoreBestsellers" }),
      },
      problems: [404],
      handler: async () => {
        if (getContext()?.tenantId === undefined) throw new NotFoundError();
        const since = new Date(Date.now() - BESTSELLER_DAYS * 24 * 60 * 60 * 1000);
        const rows = await withTenantTransaction(db, (trx) =>
          trx
            .selectFrom("orders.order_line as l")
            .innerJoin("orders.order as o", (j) =>
              j.onRef("o.id", "=", "l.order_id").onRef("o.tenant_id", "=", "l.tenant_id"),
            )
            .select(["l.product_id"])
            .select((eb) => eb.fn.sum<string>("l.quantity").as("menge"))
            .where("o.status", "in", ["open", "in_progress", "completed"])
            .where("o.placed_at", ">=", since)
            .groupBy("l.product_id")
            .orderBy("menge", "desc")
            .orderBy("l.product_id")
            .limit(BESTSELLER_LIMIT)
            .execute(),
        );
        return { productIds: rows.map((r) => r.product_id) };
      },
    }),
  ];
}
