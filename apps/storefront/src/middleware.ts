// Jede ausgelieferte Seite einmal zählen (Paket P3). Läuft auf dem Server, nicht im Browser:
// kein JavaScript, kein Cookie, nichts über einzelne Besucher. Gezählt wird erst, wenn die Seite
// fertig und in Ordnung ist (Status 200 und HTML) — Bilder, Weiterleitungen und Fehlerseiten nicht.
import type { MiddlewareHandler } from "astro";
import { pfadImShop, zaehle } from "./lib/zaehler.js";

const NICHT_ZAEHLEN = /^\/(_assets|_image|favicon|robots\.txt|sitemap)/;

export const onRequest: MiddlewareHandler = async (context, next) => {
  const antwort = await next();
  try {
    if (context.request.method !== "GET") return antwort;
    if (antwort.status !== 200) return antwort;
    if (!(antwort.headers.get("content-type") ?? "").includes("text/html")) return antwort;
    const url = new URL(context.request.url);
    if (NICHT_ZAEHLEN.test(url.pathname)) return antwort;
    const shop = url.pathname.split("/")[1] ?? "";
    if (shop === "" || shop.includes(".")) return antwort;
    zaehle(shop, pfadImShop(url, shop));
  } catch {
    // Zählen darf niemals eine Seite kaputt machen.
  }
  return antwort;
};
