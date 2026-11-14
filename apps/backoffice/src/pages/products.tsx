// Produktliste (M3): Bild, Name, Status, Kategorie, Preis, Bestand. Klick öffnet das Produkt.
// Suche und Filter (12.11.2026) stehen in der Adresse und gehen als Filter an die Admin-API.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Input, Select, Spinner } from "../components/ui.js";
import { listAll, request, type Category, type Product } from "../lib/api.js";
import { bulkMessage, bulkTargets, type BulkAction } from "../lib/bulk.js";
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
  "inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white shadow-sm " +
  "hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

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
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkInfo, setBulkInfo] = useState<string | undefined>();
  // Auswahl nur über sichtbare Produkte (nach Filterwechsel fallen andere heraus).
  const visibleIds = new Set((sorted ?? []).map((p) => p.id));
  const selectedVisible = new Set([...selected].filter((id) => visibleIds.has(id)));
  const allSelected = (sorted ?? []).length > 0 && selectedVisible.size === (sorted ?? []).length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulk = useMutation({
    mutationFn: async (action: BulkAction) => {
      const targets = bulkTargets(sorted ?? [], selectedVisible, action);
      let done = 0;
      let failed = 0;
      for (const p of targets) {
        try {
          if (action === "delete")
            await request(`/admin/v1/products/${p.id}`, { method: "DELETE", shopId: shop.id });
          else
            await request(`/admin/v1/products/${p.id}`, {
              method: "PATCH",
              body: { status: action === "publish" ? "published" : "draft" },
              shopId: shop.id,
              version: p.version,
            });
          done++;
        } catch {
          failed++;
        }
      }
      return bulkMessage(action, done, failed);
    },
    onSuccess: (message) => {
      setBulkInfo(message);
      setSelected(new Set());
    },
    onSettled: () => {
      queryClient.removeQueries({ queryKey: ["product", shop.id] });
      return queryClient.invalidateQueries({ queryKey: productsKey(shop.id) });
    },
  });
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
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Produkte</h1>
          {products.data && (
            <p className="text-sm text-gray-500" aria-live="polite">
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

      {selectedVisible.size > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white"
          role="region"
          aria-label="Sammelaktionen"
        >
          <span className="mr-2 font-medium">{selectedVisible.size} ausgewählt</span>
          <Button variant="secondary" busy={bulk.isPending} onClick={() => bulk.mutate("publish")}>
            In den Shop
          </Button>
          <Button variant="secondary" busy={bulk.isPending} onClick={() => bulk.mutate("unpublish")}>
            Aus dem Shop nehmen
          </Button>
          <Button
            variant="danger"
            busy={bulk.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `${selectedVisible.size} Produkte löschen? Das lässt sich nicht rückgängig machen.`,
                )
              )
                bulk.mutate("delete");
            }}
          >
            Löschen
          </Button>
          <button type="button" className="ml-auto underline" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      )}
      {bulkInfo !== undefined && selectedVisible.size === 0 && (
        <div className="mb-3">
          <Alert tone="success">{bulkInfo}</Alert>
        </div>
      )}

      {products.isPending && (
        <div className="flex justify-center py-16 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Produkte werden geladen …</span>
        </div>
      )}
      {products.isError && <Alert>{products.error.message}</Alert>}
      {products.data?.length === 0 && filtered && (
        <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
          <p className="font-medium">Keine Produkte gefunden</p>
          <p className="mt-1 text-sm text-gray-500">Kein Produkt passt zu Suche und Filter.</p>
          <Button variant="secondary" className="mt-4" onClick={() => setFilter({})}>
            Filter zurücksetzen
          </Button>
        </div>
      )}
      {products.data?.length === 0 && !filtered && (
        <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Produkte</p>
          <p className="mt-1 text-sm text-gray-500">
            Lege dein erstes Produkt an, mit Preis, Bestand und Bildern.
          </p>
        </div>
      )}
      {products.data && products.data.length > 0 && (
        <div
          className={
            "overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200 transition-opacity" +
            (products.isPlaceholderData ? " opacity-60" : "")
          }
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-10 py-3 pl-4">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-gray-300 text-brand-700"
                    aria-label="Alle auswählen"
                    checked={allSelected}
                    onChange={() => {
                      setBulkInfo(undefined);
                      setSelected(allSelected ? new Set() : new Set(visibleIds));
                    }}
                  />
                </th>
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
            <tbody className="divide-y divide-gray-100">
              {(sorted ?? []).map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() =>
                    void navigate({
                      to: "/$shop/produkte/$productId",
                      params: { shop: shop.handle, productId: p.id },
                    })
                  }
                >
                  <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4 rounded border-gray-300 text-brand-700"
                      aria-label={`„${p.name}“ auswählen`}
                      checked={selectedVisible.has(p.id)}
                      onChange={() => {
                        setBulkInfo(undefined);
                        toggle(p.id);
                      }}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Thumbnail product={p} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/$shop/produkte/$productId"
                      params={{ shop: shop.handle, productId: p.id }}
                      className="font-medium text-gray-900 hover:underline"
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
                  <td className="hidden px-4 py-3 text-gray-600 md:table-cell">
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
                        <span className="text-xs text-gray-400 line-through">
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
    return <div className="size-12 rounded-lg bg-gray-100 ring-1 ring-gray-200" aria-hidden="true" />;
  return (
    <img
      src={image.thumbnailUrl}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      className="size-12 rounded-lg bg-gray-100 object-cover ring-1 ring-gray-200"
    />
  );
}
