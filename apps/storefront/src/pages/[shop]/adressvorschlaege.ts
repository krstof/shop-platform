// Adressvorschläge für die Kasse (22.11.2026).
//
// Die Kasse fragt hier beim Tippen der Straße nach. Der Umweg über den eigenen Server ist Absicht:
// Die Sicherheitsregeln des Shops erlauben dem Browser nur Verbindungen zur eigenen Adresse
// (connect-src 'self'), und so erfährt der Adressdienst auch nicht, wer gerade wo bestellt.
import type { APIRoute } from "astro";
import { safeHandle, storeApi, StoreApiError } from "../../lib/store-api.js";

interface Suggestion {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly label: string;
}

const LEER = JSON.stringify({ data: [] });

/** Keine Zwischenspeicherung beim Browser: Die Eingabe ändert sich mit jedem Tastendruck. */
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export const GET: APIRoute = async ({ params, url }) => {
  const handle = safeHandle(params.shop);
  if (handle === undefined) return new Response(LEER, { headers: HEADERS });
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (query.length < 3) return new Response(LEER, { headers: HEADERS });
  try {
    const found = await storeApi<{ data: Suggestion[] }>(
      handle,
      `/address-suggestions?q=${encodeURIComponent(query)}`,
    );
    return new Response(JSON.stringify(found), { headers: HEADERS });
  } catch (e) {
    // Vorschläge sind eine Hilfe, kein Muss: Fällt etwas aus, tippt der Kunde die Adresse selbst.
    if (e instanceof StoreApiError) return new Response(LEER, { headers: HEADERS });
    throw e;
  }
};
