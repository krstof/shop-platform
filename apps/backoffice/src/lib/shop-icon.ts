// Symbol des Shops (Kristof 22.11.2026): das hochgeladene Favicon, das in der Kopfzeile des
// Backoffice neben dem Shopnamen steht. Es kommt aus dem veröffentlichten Aussehen, damit dort
// dasselbe Bild steht wie im Browser-Reiter des Shops.
import { useQuery } from "@tanstack/react-query";
import { request, type DesignState } from "./api.js";
import { useShop } from "./shop.js";

export const designFaviconKey = (shopId: string) => ["design-favicon", shopId] as const;

/** Adresse des Symbols oder `undefined`, solange es keines gibt (dann steht dort der Buchstabe). */
export function useShopIcon(): string | undefined {
  const shop = useShop();
  const q = useQuery({
    queryKey: designFaviconKey(shop.id),
    queryFn: async () => {
      const state = await request<DesignState>("/admin/v1/design", { shopId: shop.id });
      return state.published.favicon?.thumbnailUrl ?? state.published.favicon?.url ?? null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data ?? undefined;
}
