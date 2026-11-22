// Produktfeed des Shops (22.11.2026). Gebaut wird er in lib/produktfeed.ts, hier kommen nur die
// Daten dazu. Die Adresse zum Einreichen steht im Backoffice unter Einstellungen → Anbindungen.
import type { APIRoute } from "astro";
import { oeffentlicheBasis } from "../../lib/basis.js";
import { produktfeedXml } from "../../lib/produktfeed.js";
import { loadShop, safeHandle, storeApi, StoreApiError, type StoreProduct } from "../../lib/store-api.js";

export const GET: APIRoute = async ({ params, request, url }) => {
  const handle = safeHandle(params.shop);
  if (handle === undefined) return new Response(null, { status: 404 });
  try {
    const daten = await loadShop(handle);
    if (daten === undefined) return new Response(null, { status: 404 });
    const basis = `${oeffentlicheBasis(request.headers, url)}/${handle}`;
    // Die Storefront-API liefert die ersten 200 Produkte des Shops, mehr braucht der Feed nicht.
    const produkte = (await storeApi<{ data: StoreProduct[] }>(handle, "/products")).data;
    return new Response(produktfeedXml(daten.shop.name, basis, produkte), {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=900",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) return new Response(null, { status: 404 });
    throw e;
  }
};
