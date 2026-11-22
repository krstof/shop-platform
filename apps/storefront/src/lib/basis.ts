// Öffentliche Adresse des Shops (22.11.2026). Der Node-Server hinter Caddy kennt nur seinen
// internen Namen (http://localhost:4321). Für den Produktfeed brauchen Google und Co. aber die
// Adresse, unter der Kundinnen den Shop wirklich erreichen. Caddy schickt sie in zwei Kopfzeilen
// mit: X-Forwarded-Proto und X-Forwarded-Host. Fehlen sie, bleibt es bei der internen Adresse.

/** Ein Hostname, wie er in einer Adresse stehen darf. Schützt vor untergeschobenen Kopfzeilen. */
const HOST = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i;

/**
 * Liefert die öffentliche Basisadresse ohne Schrägstrich am Ende, zum Beispiel
 * „https://shop.example.com“.
 */
export function oeffentlicheBasis(kopfzeilen: Headers, intern: URL): string {
  const host = (kopfzeilen.get("x-forwarded-host") ?? "").split(",")[0]?.trim() ?? "";
  if (!HOST.test(host)) return intern.origin;
  const proto = (kopfzeilen.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  const schema = proto === "http" || proto === "https" ? proto : "https";
  return `${schema}://${host}`;
}
