// Produkt anlegen und bearbeiten (M3), mit Bildern. Beim Anlegen können Bilder schon gewählt werden;
// sie werden direkt nach dem Speichern hochgeladen. Beim Bearbeiten wirkt jede Bildaktion sofort.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "../components/ui.js";
import { MultiSelect } from "../components/select.js";
import {
  ApiError,
  categoryIdsOf,
  imageUploadData,
  request,
  type Product,
  type ProductInput,
} from "../lib/api.js";
import { centsToInput, parseEuro } from "../lib/money.js";
import { AiDescriptionButton } from "./ai-description.js";
import { FormatTextarea } from "./editor/format-bar.js";
import { useShop } from "./layout.js";
import { categoriesKey, productsKey, useCategories } from "./products.js";
import { useConfirm } from "../components/dialog.js";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

interface FormState {
  name: string;
  description: string;
  price: string;
  salePrice: string;
  taxClass: "standard" | "reduced";
  stock: string;
  lowStockThreshold: string;
  newBadge: "auto" | "always" | "never";
  searchKeywords: string;
  categoryIds: string[];
  sku: string;
  deliveryMin: string;
  deliveryMax: string;
  published: boolean;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  price: "",
  salePrice: "",
  taxClass: "standard",
  stock: "0",
  lowStockThreshold: "",
  newBadge: "auto",
  searchKeywords: "",
  categoryIds: [],
  sku: "",
  deliveryMin: "",
  deliveryMax: "",
  published: true,
};

function formFrom(p: Product): FormState {
  return {
    name: p.name,
    description: p.description,
    price: p.price === null ? "" : centsToInput(p.price.amount),
    salePrice: p.salePrice === null ? "" : centsToInput(p.salePrice.amount),
    taxClass: p.taxClass,
    stock: String(p.stock),
    lowStockThreshold:
      p.lowStockThreshold === null || p.lowStockThreshold === undefined ? "" : String(p.lowStockThreshold),
    newBadge: p.newBadge ?? "auto",
    searchKeywords: p.searchKeywords ?? "",
    categoryIds: categoryIdsOf(p),
    sku: p.sku ?? "",
    deliveryMin: p.deliveryDays ? String(p.deliveryDays.min) : "",
    deliveryMax: p.deliveryDays ? String(p.deliveryDays.max) : "",
    published: p.status === "published",
  };
}

type Errors = Partial<Record<keyof FormState | "form", string>>;

/** Liegt der eingetragene Bestand auf oder unter dem eingetragenen Mindestbestand? */
function bestandNiedrig(f: FormState): boolean {
  const bestand = Number(f.stock.trim());
  const grenze = Number(f.lowStockThreshold.trim());
  if (f.lowStockThreshold.trim() === "" || !Number.isInteger(bestand) || !Number.isInteger(grenze))
    return false;
  return bestand <= grenze;
}

function neuWert(v: string): "auto" | "always" | "never" {
  return v === "always" || v === "never" ? v : "auto";
}

/** Prüft im Browser, was sofort klar ist; der Rest kommt von der API. */
function toInput(f: FormState): { input?: ProductInput; errors: Errors } {
  const errors: Errors = {};
  const price = parseEuro(f.price);
  const sale = f.salePrice.trim() === "" ? null : parseEuro(f.salePrice);
  const stock = /^\d+$/.test(f.stock.trim()) ? Number(f.stock.trim()) : undefined;
  if (f.name.trim() === "") errors.name = "Bitte einen Namen angeben.";
  if (price === undefined) errors.price = "Bitte einen Preis wie 8,90 angeben.";
  if (stock === undefined) errors.stock = "Bitte eine ganze Zahl ab 0 angeben.";
  const minRoh = f.lowStockThreshold.trim();
  const lowStockThreshold = minRoh === "" ? null : /^\d+$/.test(minRoh) ? Number(minRoh) : undefined;
  if (lowStockThreshold === undefined)
    errors.lowStockThreshold = "Bitte eine ganze Zahl ab 0 angeben oder leer lassen.";
  const dMin = f.deliveryMin.trim();
  const dMax = f.deliveryMax.trim() === "" ? dMin : f.deliveryMax.trim();
  let deliveryDays: { min: number; max: number } | null = null;
  if (dMin !== "" || f.deliveryMax.trim() !== "") {
    const a = Number(dMin === "" ? dMax : dMin);
    const b = Number(dMax);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 120 || b < a)
      errors.deliveryMin = "Bitte Werktage wie 2 bis 3 angeben.";
    else deliveryDays = { min: a, max: b };
  }
  if (sale === undefined) errors.salePrice = "Bitte einen Preis wie 6,90 angeben oder leer lassen.";
  else if (sale !== null && price !== undefined && sale >= price)
    errors.salePrice = "Der Angebotspreis muss kleiner als der normale Preis sein.";
  if (
    Object.keys(errors).length > 0 ||
    price === undefined ||
    stock === undefined ||
    sale === undefined ||
    lowStockThreshold === undefined
  )
    return { errors };
  return {
    errors,
    input: {
      name: f.name.trim(),
      description: f.description.trim() === "" ? null : f.description,
      price: { amount: price },
      salePrice: sale === null ? null : { amount: sale },
      taxClass: f.taxClass,
      stock,
      lowStockThreshold,
      newBadge: f.newBadge,
      searchKeywords: f.searchKeywords.trim() === "" ? null : f.searchKeywords.trim(),
      categoryIds: f.categoryIds,
      sku: f.sku.trim() === "" ? null : f.sku.trim(),
      deliveryDays,
      status: f.published ? "published" : "draft",
    },
  };
}

/** Fehler der API den Feldern zuordnen. */
function errorsFromApi(e: unknown): Errors {
  if (!(e instanceof ApiError)) return { form: "Speichern hat nicht geklappt." };
  if (e.status === 412)
    return {
      form: "Jemand hat das Produkt inzwischen geändert. Bitte die Seite neu laden und noch einmal ändern.",
    };
  const out: Errors = {};
  const map: [string, keyof FormState][] = [
    ["/name", "name"],
    ["/description", "description"],
    ["/price", "price"],
    ["/salePrice", "salePrice"],
    ["/stock", "stock"],
    ["/lowStockThreshold", "lowStockThreshold"],
    ["/searchKeywords", "searchKeywords"],
    ["/categoryIds", "categoryIds"],
    ["/categoryId", "categoryIds"],
    ["/sku", "sku"],
    ["/deliveryDays", "deliveryMin"],
    ["/slug", "name"],
  ];
  for (const [path, key] of map) {
    const m = e.field(path);
    if (m !== undefined) out[key] = m;
  }
  if (e.status === 409 && out.sku === undefined && out.name === undefined) out.form = e.message;
  if (Object.keys(out).length === 0) out.form = e.message;
  return out;
}

function validateFile(file: File): string | undefined {
  if (!ACCEPTED.includes(file.type)) return `„${file.name}“: Bitte JPEG, PNG oder WebP wählen.`;
  if (file.size > MAX_FILE_BYTES) return `„${file.name}“ ist größer als 8 MB.`;
  return undefined;
}

export function NewProductPage() {
  return <ProductEditor product={undefined} />;
}

export function EditProductPage() {
  const shop = useShop();
  const { productId } = useParams({ strict: false });
  const product = useQuery({
    queryKey: ["product", shop.id, productId],
    queryFn: () => request<Product>(`/admin/v1/products/${productId ?? ""}`, { shopId: shop.id }),
  });
  if (product.isPending)
    return (
      <div className="flex justify-center py-16 text-gray-400" role="status">
        <Spinner className="size-6" />
        <span className="sr-only">Produkt wird geladen …</span>
      </div>
    );
  if (product.isError)
    return (
      <Alert>
        {product.error instanceof ApiError && product.error.status === 404
          ? "Dieses Produkt gibt es nicht (mehr)."
          : product.error.message}
      </Alert>
    );
  return <ProductEditor key={product.data.id} product={product.data} />;
}

function ProductEditor({ product }: { product: Product | undefined }) {
  const shop = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories(shop.id);
  const [form, setForm] = useState<FormState>(product ? formFrom(product) : emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const isNew = product === undefined;

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      setSaved(false);
    };

  function remember(p: Product) {
    queryClient.setQueryData(["product", shop.id, p.id], p);
    void queryClient.invalidateQueries({ queryKey: productsKey(shop.id) });
  }

  const save = useMutation({
    mutationFn: async (input: ProductInput) => {
      if (product !== undefined)
        return request<Product>(`/admin/v1/products/${product.id}`, {
          method: "PATCH",
          body: input,
          shopId: shop.id,
          version: product.version,
        });
      let created = await request<Product>("/admin/v1/products", {
        method: "POST",
        body: input,
        shopId: shop.id,
      });
      for (const file of pending) created = await uploadImage(shop.id, created.id, file);
      return created;
    },
    onSuccess: async (p) => {
      remember(p);
      setErrors({});
      setSaved(true);
      setPending([]);
      if (isNew)
        await navigate({ to: "/$shop/produkte/$productId", params: { shop: shop.handle, productId: p.id } });
      else setForm(formFrom(p));
    },
    onError: (e) => setErrors(errorsFromApi(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const { input, errors: local } = toInput(form);
    setErrors(local);
    if (input !== undefined) save.mutate(input);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/$shop/produkte"
            params={{ shop: shop.handle }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            ← Alle Produkte
          </Link>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-gray-900">
            {isNew ? "Neues Produkt" : form.name || "Produkt"}
          </h1>
        </div>
        <Button type="submit" busy={save.isPending}>
          {isNew ? "Produkt anlegen" : "Speichern"}
        </Button>
      </div>

      <div className="space-y-4" aria-live="polite">
        {errors.form && <Alert>{errors.form}</Alert>}
        {saved && !isNew && <Alert tone="success">Gespeichert.</Alert>}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="space-y-5">
              <Field label="Name" error={errors.name}>
                {(p) => (
                  <Input
                    {...p}
                    value={form.name}
                    maxLength={200}
                    onChange={(e) => set("name")(e.target.value)}
                  />
                )}
              </Field>
              <div className="-mb-3 flex justify-end">
                <AiDescriptionButton
                  shopId={shop.id}
                  name={form.name}
                  category={(categories.data ?? []).find((c) => c.id === form.categoryIds[0])?.name}
                  current={form.description}
                  onApply={(text) => set("description")(text)}
                />
              </div>
              <Field
                label="Beschreibung"
                hint="Absätze mit einer Leerzeile trennen. Markiere Text und formatiere ihn über die Leiste."
                error={errors.description}
              >
                {(p) => (
                  <FormatTextarea
                    {...p}
                    rows={7}
                    maxLength={5000}
                    value={form.description}
                    onChange={(text) => set("description")(text)}
                  />
                )}
              </Field>
            </div>
          </Card>

          <ImagesCard
            product={product}
            pending={pending}
            setPending={setPending}
            onChanged={(p) => remember(p)}
          />

          <Card title="Preis und Lager">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Preis (brutto, inkl. MwSt.)" error={errors.price}>
                {(p) => (
                  <div className="relative">
                    <Input
                      {...p}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={form.price}
                      onChange={(e) => set("price")(e.target.value)}
                      className="pr-8"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">
                      €
                    </span>
                  </div>
                )}
              </Field>
              <Field
                label="Angebotspreis"
                hint="Freiwillig. Dann zeigt der Shop den normalen Preis durchgestrichen."
                error={errors.salePrice}
              >
                {(p) => (
                  <div className="relative">
                    <Input
                      {...p}
                      inputMode="decimal"
                      placeholder="kein Angebot"
                      value={form.salePrice}
                      onChange={(e) => set("salePrice")(e.target.value)}
                      className="pr-8"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">
                      €
                    </span>
                  </div>
                )}
              </Field>
              <Field label="Mehrwertsteuer">
                {(p) => (
                  <Select
                    {...p}
                    value={form.taxClass}
                    onChange={(e) => set("taxClass")(e.target.value === "reduced" ? "reduced" : "standard")}
                  >
                    <option value="standard">19 % (normal)</option>
                    <option value="reduced">7 % (ermäßigt, z. B. Lebensmittel)</option>
                  </Select>
                )}
              </Field>
              <Field label="Bestand" error={errors.stock}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={form.stock}
                    onChange={(e) => set("stock")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Mindestbestand"
                hint="Freiwillig. Fällt der Bestand auf diese Zahl oder darunter, steht in der Produktliste „Bestand niedrig“."
                error={errors.lowStockThreshold}
              >
                {(p) => (
                  <div>
                    <Input
                      {...p}
                      inputMode="numeric"
                      placeholder="keiner"
                      value={form.lowStockThreshold}
                      onChange={(e) => set("lowStockThreshold")(e.target.value)}
                    />
                    {bestandNiedrig(form) && (
                      <p className="mt-1.5 text-sm text-amber-700">
                        Der Bestand liegt schon auf oder unter dieser Zahl.
                      </p>
                    )}
                  </div>
                )}
              </Field>
              <Field
                label="Lieferzeit (Werktage)"
                hint="Freiwillig, etwa 2 bis 3. Leer: „Sofort lieferbar“."
                error={errors.deliveryMin}
              >
                {(p) => (
                  <div className="flex items-center gap-2">
                    <Input
                      {...p}
                      inputMode="numeric"
                      placeholder="von"
                      value={form.deliveryMin}
                      onChange={(e) => set("deliveryMin")(e.target.value)}
                    />
                    <span className="text-sm text-gray-500">bis</span>
                    <Input
                      inputMode="numeric"
                      aria-label="Lieferzeit bis (Werktage)"
                      placeholder="bis"
                      value={form.deliveryMax}
                      onChange={(e) => set("deliveryMax")(e.target.value)}
                    />
                  </div>
                )}
              </Field>
              <Field label="Artikelnummer" hint="Freiwillig." error={errors.sku}>
                {(p) => (
                  <Input
                    {...p}
                    value={form.sku}
                    maxLength={64}
                    onChange={(e) => set("sku")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Suchwörter"
                hint="Freiwillig, durch Komma getrennt. Damit findet die Suche im Shop das Produkt auch unter Wörtern, die nicht im Namen oder Text stehen."
                error={errors.searchKeywords}
                className="sm:col-span-2"
              >
                {(p) => (
                  <Input
                    {...p}
                    value={form.searchKeywords}
                    maxLength={300}
                    placeholder="Geschenk, Mitbringsel, Grüntee"
                    onChange={(e) => set("searchKeywords")(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Sichtbarkeit">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
                checked={form.published}
                onChange={(e) => set("published")(e.target.checked)}
              />
              <span>
                <span className="font-medium">Im Shop sichtbar</span>
                <span className="block text-gray-500">Sonst bleibt das Produkt ein Entwurf.</span>
              </span>
            </label>
            <div className="mt-5">
              <Field
                label="Neu-Schildchen"
                hint="Das Schildchen „Neu“ auf der Produktkarte im Shop. Bei einem Angebot steht dort „Angebot“."
              >
                {(p) => (
                  <Select
                    {...p}
                    value={form.newBadge}
                    onChange={(e) => set("newBadge")(neuWert(e.target.value))}
                  >
                    <option value="auto">Automatisch (14 Tage nach dem Veröffentlichen)</option>
                    <option value="always">Immer zeigen</option>
                    <option value="never">Nie zeigen</option>
                  </Select>
                )}
              </Field>
            </div>
          </Card>
          <Card>
            <Field
              label="Kategorien"
              hint="Ein Produkt kann in mehreren Kategorien stehen; die erste ist die Hauptkategorie. Neue Kategorien unter „Kategorien“ im Menü anlegen."
              error={errors.categoryIds}
            >
              {(p) => (
                <MultiSelect
                  {...p}
                  options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={form.categoryIds}
                  onChange={(ids) => set("categoryIds")(ids)}
                  placeholder="Keine Kategorie"
                  firstLabel="Hauptkategorie"
                  emptyText="Noch keine Kategorien angelegt."
                />
              )}
            </Field>
          </Card>
          {product !== undefined && <CopyProductCard product={product} />}
          {product !== undefined && <DeleteProductCard product={product} />}
        </div>
      </div>
    </form>
  );
}

/** Kopie als Entwurf anlegen (gleiche Texte, Preis, Kategorie, Bilder) und gleich öffnen. */
function CopyProductCard({ product }: { product: Product }) {
  const shop = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = useMutation({
    mutationFn: () =>
      request<Product>(`/admin/v1/products/${product.id}/copy`, { method: "POST", shopId: shop.id }),
    onSuccess: async (p) => {
      queryClient.setQueryData(["product", shop.id, p.id], p);
      await queryClient.invalidateQueries({ queryKey: productsKey(shop.id) });
      await queryClient.invalidateQueries({ queryKey: categoriesKey(shop.id) });
      await navigate({ to: "/$shop/produkte/$productId", params: { shop: shop.handle, productId: p.id } });
    },
  });
  return (
    <Card title="Produkt kopieren">
      <p className="text-sm text-gray-500">
        Legt eine Kopie mit gleichem Text, Preis, Kategorie und Bildern an, als Entwurf mit Bestand 0.
        Praktisch für ähnliche Produkte.
      </p>
      {copy.isError && (
        <div className="mt-3">
          <Alert>{copy.error instanceof ApiError ? copy.error.message : "Das hat nicht geklappt."}</Alert>
        </div>
      )}
      <div className="mt-4">
        <Button type="button" variant="secondary" busy={copy.isPending} onClick={() => copy.mutate()}>
          Kopie anlegen
        </Button>
      </div>
    </Card>
  );
}

/** Löschen mit Rückfrage. Danach zurück zur Liste. Nur aus dem Shop nehmen geht über „Sichtbarkeit“. */
function DeleteProductCard({ product }: { product: Product }) {
  const confirm = useConfirm();
  const shop = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      request<{ id: string; deleted: true }>(`/admin/v1/products/${product.id}`, {
        method: "DELETE",
        shopId: shop.id,
      }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["product", shop.id, product.id] });
      await queryClient.invalidateQueries({ queryKey: productsKey(shop.id) });
      await queryClient.invalidateQueries({ queryKey: categoriesKey(shop.id) });
      await navigate({ to: "/$shop/produkte", params: { shop: shop.handle } });
    },
  });
  return (
    <Card title="Produkt löschen">
      <p className="text-sm text-gray-500">
        Verschwindet aus dem Shop und aus dieser Liste. Bestellungen behalten ihre Angaben.
      </p>
      {remove.isError && (
        <div className="mt-3">
          <Alert>{remove.error instanceof ApiError ? remove.error.message : "Das hat nicht geklappt."}</Alert>
        </div>
      )}
      <div className="mt-4">
        <Button
          type="button"
          variant="danger"
          busy={remove.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: `„${product.name}“ löschen?`,
                message:
                  "Das lässt sich nicht rückgängig machen. Nur aus dem Shop nehmen geht oben mit „Im Shop sichtbar“.",
                confirmLabel: "Löschen",
                tone: "danger",
              })
            )
              remove.mutate();
          }}
        >
          Löschen
        </Button>
      </div>
    </Card>
  );
}

async function uploadImage(shopId: string, productId: string, file: File): Promise<Product> {
  return request<Product>(`/admin/v1/products/${productId}/images`, {
    method: "POST",
    body: await imageUploadData(file),
    shopId,
  });
}

interface ImagesCardProps {
  product: Product | undefined;
  pending: File[];
  setPending: (files: File[]) => void;
  onChanged: (p: Product) => void;
}

/** Bilder: hochladen (Button oder hineinziehen), Reihenfolge ändern, entfernen. Erstes = Hauptbild. */
function ImagesCard({ product, pending, setPending, onChanged }: ImagesCardProps) {
  const shop = useShop();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const previews = usePreviews(pending);

  async function run(label: string, action: () => Promise<Product>) {
    setError(undefined);
    setBusy(label);
    try {
      onChanged(await action());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Das hat nicht geklappt.");
    } finally {
      setBusy(undefined);
    }
  }

  async function add(files: File[]) {
    const problems = files.map(validateFile).filter((m): m is string => m !== undefined);
    const ok = files.filter((f) => validateFile(f) === undefined);
    setError(problems.length > 0 ? problems.join(" ") : undefined);
    if (product === undefined) {
      setPending([...pending, ...ok]);
      return;
    }
    for (const file of ok) {
      await run("upload", () => uploadImage(shop.id, product.id, file));
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    void add([...(e.target.files ?? [])]);
    e.target.value = "";
  }

  function move(index: number, delta: number) {
    if (product === undefined) {
      const next = [...pending];
      const [f] = next.splice(index, 1);
      if (f) next.splice(index + delta, 0, f);
      setPending(next);
      return;
    }
    const ids = product.images.map((i) => i.id);
    const [id] = ids.splice(index, 1);
    if (id === undefined) return;
    ids.splice(index + delta, 0, id);
    void run("order", () =>
      request<Product>(`/admin/v1/products/${product.id}/images`, {
        method: "PUT",
        body: { imageIds: ids },
        shopId: shop.id,
      }),
    );
  }

  function remove(index: number) {
    if (product === undefined) {
      setPending(pending.filter((_, i) => i !== index));
      return;
    }
    const image = product.images[index];
    if (image === undefined) return;
    void run("remove", () =>
      request<Product>(`/admin/v1/products/${product.id}/images/${image.id}`, {
        method: "DELETE",
        shopId: shop.id,
      }),
    );
  }

  const items =
    product === undefined
      ? previews.map((url, i) => ({ key: `${i}-${url}`, url, label: pending[i]?.name ?? "" }))
      : product.images.map((img) => ({ key: img.id, url: img.thumbnailUrl, label: "" }));

  return (
    <Card title="Bilder">
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Bilder des Produkts">
        {items.map((item, i) => (
          <li key={item.key} className="group relative">
            <img
              src={item.url}
              alt={i === 0 ? "Hauptbild" : `Bild ${i + 1}`}
              className="aspect-square w-full rounded-lg bg-gray-100 object-cover ring-1 ring-gray-200"
            />
            {i === 0 && (
              <span className="absolute top-2 left-2 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium shadow-sm">
                Hauptbild
              </span>
            )}
            <div className="mt-1.5 flex justify-between gap-1">
              <div className="flex gap-1">
                <IconButton
                  label="Nach vorn"
                  disabled={i === 0 || busy !== undefined}
                  onClick={() => move(i, -1)}
                >
                  ←
                </IconButton>
                <IconButton
                  label="Nach hinten"
                  disabled={i === items.length - 1 || busy !== undefined}
                  onClick={() => move(i, 1)}
                >
                  →
                </IconButton>
              </div>
              <IconButton label="Bild entfernen" disabled={busy !== undefined} onClick={() => remove(i)}>
                ✕
              </IconButton>
            </div>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void add([...e.dataTransfer.files]);
            }}
            disabled={busy === "upload"}
            className={
              "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed " +
              "text-sm text-gray-500 transition-colors hover:border-brand-600 hover:text-brand-800 " +
              "focus-visible:outline-2 focus-visible:outline-brand-600 " +
              (dragging ? "border-brand-600 bg-brand-50" : "border-gray-300")
            }
          >
            {busy === "upload" ? (
              <>
                <Spinner />
                <span>Lädt hoch …</span>
              </>
            ) : (
              <>
                <span className="text-2xl leading-none" aria-hidden="true">
                  +
                </span>
                <span>Bild hinzufügen</span>
              </>
            )}
          </button>
        </li>
      </ul>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
      />
      <p className="mt-3 text-xs text-gray-500">
        JPEG, PNG oder WebP, bis 8 MB. Das erste Bild ist das Hauptbild.
        {product === undefined && pending.length > 0 && " Die Bilder werden beim Anlegen hochgeladen."}
      </p>
    </Card>
  );
}

function IconButton({
  label,
  children,
  ...rest
}: {
  label: string;
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className="rounded-md px-2 py-1 text-xs text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-600"
    >
      {children}
    </button>
  );
}

/** Vorschau-Adressen für noch nicht hochgeladene Dateien (werden wieder freigegeben). */
function usePreviews(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}
