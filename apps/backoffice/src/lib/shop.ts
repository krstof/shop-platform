// Der gewählte Shop für alle Seiten innerhalb des Shops (gesetzt in pages/layout.tsx).
import { createContext, useContext, useEffect } from "react";
import type { ShopOfUser } from "./api.js";

export const ShopContext = createContext<ShopOfUser | null>(null);

/** Der gewählte Shop. Nur innerhalb von ShopLayout verwenden. */
export function useShop(): ShopOfUser {
  const shop = useContext(ShopContext);
  if (shop === null) throw new Error("useShop außerhalb eines Shops");
  return shop;
}

/**
 * Wohin der Button „Shop ansehen" führt (Kristof 23.11.2026). Ohne Angabe ist das die Startseite
 * des Shops. Eine Seite, die etwas bearbeitet, meldet hier ihren Pfad im Shop an — das Produkt
 * meldet also „/produkt/sencha", und der Button führt genau dorthin statt auf die Startseite.
 */
export const StorefrontZielContext = createContext<((pfad: string | null) => void) | null>(null);

/**
 * Meldet den Pfad im Shop an, solange die Seite offen ist. `null` oder `undefined` heißt: nichts
 * Besonderes, der Button bleibt auf der Startseite.
 */
export function useStorefrontZiel(pfad: string | null | undefined): void {
  const setzen = useContext(StorefrontZielContext);
  useEffect(() => {
    if (setzen === null) return;
    setzen(pfad ?? null);
    return () => setzen(null);
  }, [setzen, pfad]);
}
