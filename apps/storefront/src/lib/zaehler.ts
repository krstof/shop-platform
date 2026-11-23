// Seitenaufrufe zählen (Paket P3, Analytics-Seite im Backoffice).
//
// Gezählt wird hier, auf dem Server der Storefront: Jede ausgelieferte Seite zählt einmal. Damit
// braucht der Shop kein JavaScript im Browser, kein Cookie und keine fremde Statistik; gespeichert
// wird nur, wie oft ein Pfad an einem Tag aufgerufen wurde — nichts über einzelne Besucher.
//
// Die Meldung an die API läuft gebündelt: Aufrufe sammeln sich kurz im Speicher und gehen dann in
// einem Rutsch weg. Das kostet pro Seite nichts und übersteht auch einen Ansturm. Geht die Meldung
// schief oder startet der Dienst neu, fehlen ein paar Aufrufe; für eine Statistik ist das in
// Ordnung, und es darf auf keinen Fall die Seite selbst aufhalten.
import { storeApi } from "./store-api.js";

/** Wie lange Aufrufe gesammelt werden, bevor sie gemeldet werden. */
const BUENDEL_MS = 10_000;
/** Höchstens so viele verschiedene Seiten je Shop im Speicher (die API nimmt nicht mehr). */
const MAX_PFADE = 50;

type Art = "start" | "produkt" | "kategorie" | "seite" | "sonstige";

const offen = new Map<string, Map<string, { art: Art; anzahl: number }>>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Welche Art von Seite ist das? Dieselben Arten wie in der API (modules/storefront). */
export function art(pfad: string): Art {
  if (pfad === "/" || pfad === "") return "start";
  if (pfad.startsWith("/produkt/")) return "produkt";
  if (pfad.startsWith("/kategorie/")) return "kategorie";
  if (pfad.startsWith("/seite/")) return "seite";
  return "sonstige";
}

/**
 * Den Pfad innerhalb des Shops bestimmen: aus `/teeladen/produkt/sencha` wird `/produkt/sencha`.
 * Der Anhang hinter `?` bleibt weg, damit Sortierung und Filter nicht als eigene Seiten zählen.
 */
export function pfadImShop(url: URL, shop: string): string {
  const roh = url.pathname.replace(/\/+$/, "");
  const ohneShop = roh.startsWith(`/${shop}`) ? roh.slice(shop.length + 1) : roh;
  return ohneShop === "" ? "/" : ohneShop;
}

/** Einen Aufruf vormerken. Kehrt sofort zurück; gemeldet wird später und nebenher. */
export function zaehle(shop: string, pfad: string): void {
  const seiten = offen.get(shop) ?? new Map<string, { art: Art; anzahl: number }>();
  if (!offen.has(shop)) offen.set(shop, seiten);
  const da = seiten.get(pfad);
  if (da !== undefined) da.anzahl += 1;
  else if (seiten.size < MAX_PFADE) seiten.set(pfad, { art: art(pfad), anzahl: 1 });
  if (timer === undefined) timer = setTimeout(() => void melden(), BUENDEL_MS);
}

/** Alles Vorgemerkte melden. Fehler bleiben hier; die Storefront merkt davon nichts. */
export async function melden(): Promise<void> {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  const stapel = [...offen.entries()];
  offen.clear();
  for (const [shop, seiten] of stapel) {
    const entries = [...seiten.entries()].map(([path, s]) => ({ path, kind: s.art, count: s.anzahl }));
    if (entries.length === 0) continue;
    try {
      await storeApi(shop, "/views", { method: "POST", body: { entries } });
    } catch {
      // Statistik ist nicht wichtig genug, um irgendetwas zu stören.
    }
  }
}
