// Merkzettel (Wunschliste) ohne Kundenkonto und ohne JavaScript: die Produkt-IDs stehen in einem Cookie
// je Shop (nur für diesen Shop gültig, höchstens 50). Der Server liest es, der Browser sieht es nicht (httpOnly).
import type { AstroCookies } from "astro";

export const MERKZETTEL_COOKIE = "merkzettel";
export const MAX_MERKZETTEL = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cookie-Wert lesen: nur gültige IDs, ohne Doppelte, neueste zuerst. */
export function parseMerkzettel(value: string | undefined): string[] {
  if (value === undefined || value === "") return [];
  const ids = value.split(".").filter((x) => UUID.test(x));
  return [...new Set(ids)].slice(0, MAX_MERKZETTEL);
}

/** Produkt hinzufügen (vorne) oder entfernen. */
export function changeMerkzettel(ids: readonly string[], id: string, add: boolean): string[] {
  if (!UUID.test(id)) return [...ids];
  const rest = ids.filter((x) => x !== id);
  return add ? [id, ...rest].slice(0, MAX_MERKZETTEL) : rest;
}

export function readMerkzettel(cookies: AstroCookies): string[] {
  return parseMerkzettel(cookies.get(MERKZETTEL_COOKIE)?.value);
}

export function writeMerkzettel(cookies: AstroCookies, shop: string, ids: readonly string[]): void {
  cookies.set(MERKZETTEL_COOKIE, ids.join("."), {
    path: `/${shop}`,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180,
  });
}
