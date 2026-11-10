// Shop in der Storefront-API (M4): Name und Kürzel für Kopf und Titel der Shop-Seiten.
import { defineEndpoint, type Endpoint } from "@shop/http";
import { getContext, NotFoundError } from "@shop/kernel";
import { z } from "zod";
import type { ShopDirectory } from "../internal/shops.js";

const handleParam = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  .meta({ description: "Kürzel des Shops, etwa `teeladen`." });

export function storeShopEndpoints(shops: Pick<ShopDirectory, "getShops">): Endpoint[] {
  return [
    defineEndpoint({
      api: "store",
      method: "GET",
      path: "/shops/{shopHandle}",
      operationId: "getStoreShop",
      summary: "Shop lesen",
      description: "Name und Kürzel eines aktiven Shops. Unbekannte oder gesperrte Shops ergeben 404.",
      tags: ["Storefront"],
      access: { public: true, reason: "Jeder Besucher sieht den Namen des Shops, den er aufruft." },
      params: z.strictObject({ shopHandle: handleParam }),
      response: {
        status: 200,
        description: "Der Shop.",
        schema: z.object({ handle: z.string(), name: z.string() }).meta({ id: "StoreShop" }),
      },
      problems: [404],
      handler: async () => {
        const [shop] = await shops.getShops([getContext()?.tenantId ?? ""]);
        if (shop === undefined) throw new NotFoundError();
        return { handle: shop.handle, name: shop.name };
      },
    }),
  ];
}
