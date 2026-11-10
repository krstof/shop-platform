// Warenkorb in der Storefront. Kommt mit M6; bis dahin ist er immer leer.
import type { AstroCookies } from "astro";

export async function warenkorbAnzahl(cookies: AstroCookies, shop: string): Promise<number> {
  return cookies.has(`warenkorb-${shop}`) ? 0 : 0;
}
