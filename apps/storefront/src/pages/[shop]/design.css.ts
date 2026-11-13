// Farbe und Schrift des Shops als CSS-Datei (Shop-Editor Teil 1). Eine eigene Datei statt Stilen in
// der Seite, weil die Sicherheitsregeln (CSP, style-src 'self') nur Stildateien der eigenen Adresse
// erlauben. Die Seiten hängen eine Version an die Adresse, damit Änderungen sofort ankommen.
import type { APIRoute } from "astro";
import { designCss } from "../../lib/design.js";
import { loadDesign, safeHandle, StoreApiError } from "../../lib/store-api.js";

export const GET: APIRoute = async ({ params }) => {
  const handle = safeHandle(params.shop);
  if (handle === undefined) return new Response(null, { status: 404 });
  try {
    const css = designCss(await loadDesign(handle));
    return new Response(css, {
      headers: { "content-type": "text/css; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  } catch (e) {
    if (e instanceof StoreApiError && e.status === 404) return new Response(null, { status: 404 });
    throw e;
  }
};
