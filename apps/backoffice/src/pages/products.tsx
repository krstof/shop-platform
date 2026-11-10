// Produktliste (M3): Bild, Name, Status, Kategorie, Preis, Bestand. Klick öffnet das Produkt.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Alert, Badge, Spinner } from "../components/ui.js";
import { listAll, type Category, type Product } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";

export function productsKey(shopId: string) {
  return ["products", shopId] as const;
}

export function categoriesKey(shopId: string) {
  return ["categories", shopId] as const;
}

export function useCategories(shopId: string) {
  return useQuery({
    queryKey: categoriesKey(shopId),
    queryFn: () => listAll<Category>("/admin/v1/categories", shopId),
  });
}

const newButton =
  "inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm " +
  "hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

export function ProductsPage() {
  const shop = useShop();
  const navigate = useNavigate();
  const products = useQuery({
    queryKey: productsKey(shop.id),
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });
  const categories = useCategories(shop.id);
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produkte</h1>
          {products.data && (
            <p className="text-sm text-stone-500">
              {products.data.length === 1 ? "1 Produkt" : `${products.data.length} Produkte`}
            </p>
          )}
        </div>
        <Link to="/$shop/produkte/neu" params={{ shop: shop.handle }} className={newButton}>
          <span aria-hidden="true">+</span> Produkt anlegen
        </Link>
      </div>

      {products.isPending && (
        <div className="flex justify-center py-16 text-stone-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Produkte werden geladen …</span>
        </div>
      )}
      {products.isError && <Alert>{products.error.message}</Alert>}
      {products.data?.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Produkte</p>
          <p className="mt-1 text-sm text-stone-500">
            Lege dein erstes Produkt an, mit Preis, Bestand und Bildern.
          </p>
        </div>
      )}
      {products.data && products.data.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
              <tr>
                <th scope="col" className="w-16 px-4 py-3">
                  <span className="sr-only">Bild</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Produkt
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Kategorie
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Preis
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                  Bestand
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {products.data.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-stone-50"
                  onClick={() =>
                    void navigate({
                      to: "/$shop/produkte/$productId",
                      params: { shop: shop.handle, productId: p.id },
                    })
                  }
                >
                  <td className="px-4 py-2">
                    <Thumbnail product={p} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/$shop/produkte/$productId"
                      params={{ shop: shop.handle, productId: p.id }}
                      className="font-medium text-stone-900 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.name}
                    </Link>
                    <div className="mt-1">
                      {p.status === "published" ? (
                        <Badge tone="green">Im Shop</Badge>
                      ) : (
                        <Badge tone="stone">Entwurf</Badge>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-stone-600 md:table-cell">
                    {p.categoryId === null ? "–" : (categoryName.get(p.categoryId) ?? "–")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.price === null ? "–" : formatEuro(p.price.amount)}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {p.stock === 0 ? <Badge tone="amber">ausverkauft</Badge> : p.stock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Thumbnail({ product }: { product: Product }) {
  const image = product.images[0];
  if (image === undefined)
    return <div className="size-12 rounded-lg bg-stone-100 ring-1 ring-stone-200" aria-hidden="true" />;
  return (
    <img
      src={image.thumbnailUrl}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      className="size-12 rounded-lg bg-stone-100 object-cover ring-1 ring-stone-200"
    />
  );
}
