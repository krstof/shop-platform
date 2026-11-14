// Produktliste (M3): Bild, Name, Status, Kategorie, Preis, Bestand. Klick öffnet das Produkt.
// Suche und Filter (12.11.2026) stehen in der Adresse und gehen als Filter an die Admin-API.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Input, Select, Spinner } from "../components/ui.js";
import { listAll, type Category, type Product } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import {
  isFiltered,
  parseProductFilter,
  PRODUCT_SORTS,
  productListPath,
  sortProducts,
  type ProductFilter,
  type ProductSort,
} from "../lib/product-filter.js";
import { useShop } from "./layout.js";

/** Filter beim Ändern: ein Feld auf `undefined` setzen heißt „nicht filtern“. */
type FilterInput = { [K in keyof ProductFilter]?: ProductFilter[K] | undefined };

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
  const filter = useSearch({ from: "/$shop/produkte" });
  const filtered = isFiltered(filter);
  const products = useQuery({
    queryKey: [...productsKey(shop.id), "liste", { ...filter, sortierung: undefined }],
    queryFn: () => listAll<Product>(productListPath(filter), shop.id),
    placeholderData: keepPreviousData,
  });
  const sorted = products.data === undefined ? undefined : sortProducts(products.data, filter.sortierung);
  const categories = useCategories(shop.id);
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  const setFilter = useCallback(
    (next: FilterInput) =>
      void navigate({
        to: "/$shop/produkte",
        params: { shop: shop.handle },
        search: parseProductFilter({ ...next }),
        replace: true,
      }),
    [navigate, shop.handle],
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produkte</h1>
          {products.data && (
            <p className="text-sm text-stone-500" aria-live="polite">
              {filtered
                ? products.data.length === 1
                  ? "1 Treffer"
                  : `${products.data.length} Treffer`
                : products.data.length === 1
                  ? "1 Produkt"
                  : `${products.data.length} Produkte`}
            </p>
          )}
        </div>
        <Link to="/$shop/produkte/neu" params={{ shop: shop.handle }} className={newButton}>
          <span aria-hidden="true">+</span> Produkt anlegen
        </Link>
      </div>

      <FilterBar filter={filter} categories={categories.data ?? []} onChange={setFilter} />

      {products.isPending && (
        <div className="flex justify-center py-16 text-stone-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Produkte werden geladen …</span>
        </div>
      )}
      {products.isError && <Alert>{products.error.message}</Alert>}
      {products.data?.length === 0 && filtered && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Keine Produkte gefunden</p>
          <p className="mt-1 text-sm text-stone-500">Kein Produkt passt zu Suche und Filter.</p>
          <Button variant="secondary" className="mt-4" onClick={() => setFilter({})}>
            Filter zurücksetzen
          </Button>
        </div>
      )}
      {products.data?.length === 0 && !filtered && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Produkte</p>
          <p className="mt-1 text-sm text-stone-500">
            Lege dein erstes Produkt an, mit Preis, Bestand und Bildern.
          </p>
        </div>
      )}
      {products.data && products.data.length > 0 && (
        <div
          className={
            "overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200 transition-opacity" +
            (products.isPlaceholderData ? " opacity-60" : "")
          }
        >
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
              {(sorted ?? []).map((p) => (
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
                    {p.price === null ? (
                      "–"
                    ) : p.salePrice === null ? (
                      formatEuro(p.price.amount)
                    ) : (
                      <span className="flex flex-col items-end">
                        <span className="font-medium text-red-700">{formatEuro(p.salePrice.amount)}</span>
                        <span className="text-xs text-stone-400 line-through">
                          <span className="sr-only">statt </span>
                          {formatEuro(p.price.amount)}
                        </span>
                      </span>
                    )}
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

/** Suchfeld plus Auswahl für Kategorie und Status. Die Suche wartet kurz, bis man aufhört zu tippen. */
function FilterBar({
  filter,
  categories,
  onChange,
}: {
  filter: ProductFilter;
  categories: readonly Category[];
  onChange: (next: FilterInput) => void;
}) {
  const [text, setText] = useState(filter.suche ?? "");
  // Ändert sich die Adresse von außen (Zurück, „Filter zurücksetzen“), das Feld nachziehen.
  useEffect(() => setText(filter.suche ?? ""), [filter.suche]);
  useEffect(() => {
    const value = text.trim();
    if (value === (filter.suche ?? "")) return;
    const timer = setTimeout(() => onChange({ ...filter, suche: value || undefined }), 300);
    return () => clearTimeout(timer);
  }, [text, filter, onChange]);

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row" role="search">
      <label className="sm:flex-1">
        <span className="sr-only">Produkte suchen</span>
        <Input
          type="search"
          value={text}
          maxLength={100}
          placeholder="Suchen nach Name oder Artikelnummer"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="sm:w-48">
        <span className="sr-only">Kategorie</span>
        <Select
          value={filter.kategorie ?? ""}
          onChange={(e) => onChange({ ...filter, kategorie: e.target.value || undefined })}
        >
          <option value="">Alle Kategorien</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="sm:w-52">
        <span className="sr-only">Sortieren</span>
        <Select
          value={filter.sortierung ?? "neueste"}
          onChange={(e) =>
            onChange({
              ...filter,
              sortierung: e.target.value === "neueste" ? undefined : (e.target.value as ProductSort),
            })
          }
        >
          {PRODUCT_SORTS.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="sm:w-40">
        <span className="sr-only">Status</span>
        <Select
          value={filter.status ?? ""}
          onChange={(e) =>
            onChange({ ...filter, status: (e.target.value || undefined) as ProductFilter["status"] })
          }
        >
          <option value="">Alle</option>
          <option value="sichtbar">Im Shop</option>
          <option value="entwurf">Entwurf</option>
        </Select>
      </label>
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
