// Schlüsseldatei für IndexNow (22.11.2026).
//
// Wenn der Shop Bing oder Yandex meldet „diese Seite hat sich geändert“, prüft die Suchmaschine,
// ob die Meldung wirklich von diesem Shop kommt: Sie ruft eine Textdatei unter der Adresse des
// Shops ab, in der genau der gemeldete Schlüssel steht. Diese Route liefert sie aus.
//
// Nur der eine richtige Schlüssel führt zu einer Antwort; jede andere Adresse ergibt 404, damit die
// Route nicht zu einem Weg wird, beliebige Textdateien zu erfinden.
import type { APIRoute } from "astro";
import { safeHandle, storeApi, StoreApiError } from "../../lib/store-api.js";

export const GET: APIRoute = async ({ params }) => {
  const handle = safeHandle(params.shop);
  const angefragt = params.schluessel ?? "";
  if (handle === undefined || !/^[0-9a-f]{16,64}$/.test(angefragt))
    return new Response(null, { status: 404 });
  try {
    const { key } = await storeApi<{ key: string | null }>(handle, "/indexnow-key");
    if (key === null || key !== angefragt) return new Response(null, { status: 404 });
    return new Response(key, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof StoreApiError) return new Response(null, { status: 404 });
    throw e;
  }
};
