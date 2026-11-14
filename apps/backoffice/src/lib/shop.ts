// Der gewählte Shop für alle Seiten innerhalb des Shops (gesetzt in pages/layout.tsx).
import { createContext, useContext } from "react";
import type { ShopOfUser } from "./api.js";

export const ShopContext = createContext<ShopOfUser | null>(null);

/** Der gewählte Shop. Nur innerhalb von ShopLayout verwenden. */
export function useShop(): ShopOfUser {
  const shop = useContext(ShopContext);
  if (shop === null) throw new Error("useShop außerhalb eines Shops");
  return shop;
}
