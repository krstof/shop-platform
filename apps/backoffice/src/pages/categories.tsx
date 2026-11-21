// Kategorien im Backoffice: Liste mit Reihenfolge (↑/↓), anlegen und ändern. Nutzt die Admin-API aus M2.
// Einfache Liste ohne Unterkategorien; Löschen gibt es noch nicht (siehe STATUS.md, „Später“).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, Spinner, Textarea } from "../components/ui.js";
import {
  ApiError,
  imageUploadData,
  listAll,
  request,
  type Category,
  type CategoryInput,
  type Product,
} from "../lib/api.js";
import { useShop } from "./layout.js";
import { categoriesKey, productsKey, useCategories } from "./products.js";
import { useConfirm } from "../components/dialog.js";

const newButton =
  "inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white shadow-sm " +
  "hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

/** Neue Reihenfolge nach dem Verschieben eines Eintrags um einen Platz (Abstand 10, Position ab 10). */
export function reorder(
  list: readonly { id: string; position: number }[],
  index: number,
  direction: -1 | 1,
): { id: string; position: number }[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return [];
  const ids = list.map((c) => c.id);
  [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
  const before = new Map(list.map((c) => [c.id, c.position]));
  return ids.map((id, i) => ({ id, position: (i + 1) * 10 })).filter((c) => before.get(c.id) !== c.position);
}

export function CategoriesPage() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const categories = useCategories(shop.id);
  const products = useQuery({
    queryKey: productsKey(shop.id),
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });
  const count = new Map<string, number>();
  for (const p of products.data ?? [])
    if (p.categoryId !== null) count.set(p.categoryId, (count.get(p.categoryId) ?? 0) + 1);

  const move = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const list = categories.data ?? [];
      const byId = new Map(list.map((c) => [c.id, c]));
      for (const change of reorder(list, index, direction)) {
        const c = byId.get(change.id);
        if (c === undefined) continue;
        await request<Category>(`/admin/v1/categories/${c.id}`, {
          method: "PATCH",
          body: { position: change.position },
          shopId: shop.id,
          version: c.version,
        });
      }
    },
    onSettled: () => {
      // Verschieben ändert die Version; zwischengespeicherte Einzelansichten wären danach veraltet (412).
      queryClient.removeQueries({ queryKey: ["category", shop.id] });
      return queryClient.invalidateQueries({ queryKey: categoriesKey(shop.id) });
    },
  });

  const list = categories.data ?? [];
  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Kategorien</h1>
          {categories.data && (
            <p className="text-sm text-gray-500">
              {list.length === 1 ? "1 Kategorie" : `${list.length} Kategorien`} · Reihenfolge wie im Shop
            </p>
          )}
        </div>
        <Link to="/$shop/kategorien/neu" params={{ shop: shop.handle }} className={newButton}>
          <span aria-hidden="true">+</span> Kategorie anlegen
        </Link>
      </div>

      {move.isError && (
        <div className="mb-4">
          <Alert>
            {move.error instanceof ApiError && move.error.status === 412
              ? "Jemand hat die Kategorien inzwischen geändert. Die Liste ist neu geladen, bitte noch einmal verschieben."
              : move.error.message}
          </Alert>
        </div>
      )}
      {categories.isPending && (
        <div className="flex justify-center py-16 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Kategorien werden geladen …</span>
        </div>
      )}
      {categories.isError && <Alert>{categories.error.message}</Alert>}
      {categories.data?.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Kategorien</p>
          <p className="mt-1 text-sm text-gray-500">
            Mit Kategorien finden Kunden im Shop schneller, was sie suchen.
          </p>
        </div>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
          {list.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex flex-col">
                <MoveButton
                  label={`„${c.name}“ nach oben`}
                  disabled={i === 0 || move.isPending}
                  onClick={() => move.mutate({ index: i, direction: -1 })}
                >
                  ↑
                </MoveButton>
                <MoveButton
                  label={`„${c.name}“ nach unten`}
                  disabled={i === list.length - 1 || move.isPending}
                  onClick={() => move.mutate({ index: i, direction: 1 })}
                >
                  ↓
                </MoveButton>
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to="/$shop/kategorien/$categoryId"
                  params={{ shop: shop.handle, categoryId: c.id }}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {c.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {c.visible ? <Badge tone="green">Im Shop</Badge> : <Badge tone="stone">Versteckt</Badge>}
                  <span>
                    {products.data === undefined
                      ? ""
                      : (count.get(c.id) ?? 0) === 1
                        ? "1 Produkt"
                        : `${count.get(c.id) ?? 0} Produkte`}
                  </span>
                </div>
              </div>
              <Link
                to="/$shop/kategorien/$categoryId"
                params={{ shop: shop.handle, categoryId: c.id }}
                className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                aria-label={`„${c.name}“ bearbeiten`}
              >
                Bearbeiten
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-brand-600"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

interface FormState {
  name: string;
  description: string;
  visible: boolean;
}

type Errors = Partial<Record<"name" | "description" | "form", string>>;

function errorsFromApi(e: unknown): Errors {
  if (!(e instanceof ApiError)) return { form: "Speichern hat nicht geklappt." };
  if (e.status === 412)
    return {
      form: "Jemand hat die Kategorie inzwischen geändert. Bitte die Seite neu laden und noch einmal ändern.",
    };
  const out: Errors = {};
  const name = e.field("/name") ?? e.field("/slug");
  const description = e.field("/description");
  if (name !== undefined) out.name = name;
  if (description !== undefined) out.description = description;
  if (e.status === 409 && out.name === undefined)
    out.name = "Eine Kategorie mit dieser Adresse gibt es schon. Bitte einen anderen Namen wählen.";
  if (Object.keys(out).length === 0) out.form = e.message;
  return out;
}

export function NewCategoryPage() {
  return <CategoryEditor category={undefined} />;
}

export function EditCategoryPage() {
  const shop = useShop();
  const { categoryId } = useParams({ strict: false });
  const category = useQuery({
    queryKey: ["category", shop.id, categoryId],
    queryFn: () => request<Category>(`/admin/v1/categories/${categoryId ?? ""}`, { shopId: shop.id }),
  });
  if (category.isPending)
    return (
      <div className="flex justify-center py-16 text-gray-400" role="status">
        <Spinner className="size-6" />
        <span className="sr-only">Kategorie wird geladen …</span>
      </div>
    );
  if (category.isError)
    return (
      <Alert>
        {category.error instanceof ApiError && category.error.status === 404
          ? "Diese Kategorie gibt es nicht (mehr)."
          : category.error.message}
      </Alert>
    );
  return <CategoryEditor key={category.data.id} category={category.data} />;
}

function CategoryEditor({ category }: { category: Category | undefined }) {
  const shop = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories(shop.id);
  const isNew = category === undefined;
  const [form, setForm] = useState<FormState>({
    name: category?.name ?? "",
    description: category?.description ?? "",
    visible: category?.visible ?? true,
  });
  const [current, setCurrent] = useState(category);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      setSaved(false);
    };

  const save = useMutation({
    mutationFn: (input: CategoryInput) => {
      if (current !== undefined)
        return request<Category>(`/admin/v1/categories/${current.id}`, {
          method: "PATCH",
          body: input,
          shopId: shop.id,
          version: current.version,
        });
      // Neue Kategorien hinten anhängen (die API setzt sonst Position 0, also ganz nach vorn).
      const last = Math.max(0, ...(categories.data ?? []).map((c) => c.position));
      return request<Category>("/admin/v1/categories", {
        method: "POST",
        body: { ...input, position: last + 10 },
        shopId: shop.id,
      });
    },
    onSuccess: async (c) => {
      if (!isNew) queryClient.setQueryData(["category", shop.id, c.id], c);
      void queryClient.invalidateQueries({ queryKey: categoriesKey(shop.id) });
      setErrors({});
      if (isNew) {
        await navigate({ to: "/$shop/kategorien", params: { shop: shop.handle } });
        return;
      }
      setCurrent(c);
      setForm({ name: c.name, description: c.description, visible: c.visible });
      setSaved(true);
    },
    onError: (e) => setErrors(errorsFromApi(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (form.name.trim() === "") {
      setErrors({ name: "Bitte einen Namen angeben." });
      return;
    }
    setErrors({});
    save.mutate({
      name: form.name.trim(),
      description: form.description.trim() === "" ? null : form.description,
      visible: form.visible,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/$shop/kategorien"
            params={{ shop: shop.handle }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            ← Alle Kategorien
          </Link>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-gray-900">
            {isNew ? "Neue Kategorie" : form.name || "Kategorie"}
          </h1>
        </div>
        <Button type="submit" busy={save.isPending}>
          {isNew ? "Kategorie anlegen" : "Speichern"}
        </Button>
      </div>

      <div className="space-y-4" aria-live="polite">
        {errors.form && <Alert>{errors.form}</Alert>}
        {saved && <Alert tone="success">Gespeichert.</Alert>}
      </div>

      <div className="mt-4 space-y-6">
        <Card>
          <div className="space-y-5">
            <Field
              label="Name"
              hint={current ? `Adresse im Shop: …/${current.slug}` : "Erscheint so im Menü des Shops."}
              error={errors.name}
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  maxLength={100}
                  onChange={(e) => set("name")(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Beschreibung"
              hint="Freiwillig. Steht im Shop über den Produkten der Kategorie."
              error={errors.description}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  maxLength={5000}
                  value={form.description}
                  onChange={(e) => set("description")(e.target.value)}
                />
              )}
            </Field>
          </div>
        </Card>
        <Card title="Sichtbarkeit">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
              checked={form.visible}
              onChange={(e) => set("visible")(e.target.checked)}
            />
            <span>
              <span className="font-medium">Im Shop sichtbar</span>
              <span className="block text-gray-500">
                Versteckte Kategorien erscheinen nicht im Menü des Shops.
              </span>
            </span>
          </label>
        </Card>
        {current !== undefined && (
          <CategoryImageCard
            category={current}
            onChanged={(c) => {
              // Das Bild ändert die Version; ohne Nachziehen gäbe das nächste Speichern 412.
              setCurrent(c);
              queryClient.setQueryData(["category", shop.id, c.id], c);
              void queryClient.invalidateQueries({ queryKey: categoriesKey(shop.id) });
            }}
          />
        )}
        {current !== undefined && <DeleteCategoryCard category={current} />}
      </div>
    </form>
  );
}

/** Bild der Kategorie: hochladen, ersetzen, entfernen. Wirkt sofort (wie Produktbilder). */
function CategoryImageCard({
  category,
  onChanged,
}: {
  category: Category;
  onChanged: (c: Category) => void;
}) {
  const shop = useShop();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const upload = useMutation({
    mutationFn: async (file: File) =>
      request<Category>(`/admin/v1/categories/${category.id}/image`, {
        method: "PUT",
        body: await imageUploadData(file),
        shopId: shop.id,
      }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () =>
      request<Category>(`/admin/v1/categories/${category.id}/image`, { method: "DELETE", shopId: shop.id }),
    onSuccess: onChanged,
  });
  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file === undefined) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setProblem("Bitte JPEG, PNG oder WebP wählen.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProblem("Das Bild ist größer als 8 MB.");
      return;
    }
    setProblem(undefined);
    upload.mutate(file);
  };
  const error = problem ?? (upload.error ?? remove.error)?.message;
  return (
    <Card title="Bild">
      <p className="mb-3 text-sm text-gray-500">
        Erscheint auf der Kachel der Startseite und oben auf der Kategorieseite. Querformat passt am besten.
      </p>
      {category.image ? (
        <img
          src={category.image.thumbnailUrl}
          alt=""
          className="mb-3 h-36 w-full max-w-sm rounded-lg bg-gray-100 object-cover ring-1 ring-gray-200"
        />
      ) : (
        <div className="mb-3 flex h-36 w-full max-w-sm items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-400">
          Noch kein Bild
        </div>
      )}
      {error !== undefined && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={choose}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          busy={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {category.image ? "Bild ersetzen" : "Bild hochladen"}
        </Button>
        {category.image && (
          <Button type="button" variant="ghost" busy={remove.isPending} onClick={() => remove.mutate()}>
            Entfernen
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Löschen mit Rückfrage. Die Produkte der Kategorie bleiben, nur ohne Kategorie. */
function DeleteCategoryCard({ category }: { category: Category }) {
  const confirm = useConfirm();
  const shop = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      request<{ id: string; deleted: true; productsWithoutCategory: number }>(
        `/admin/v1/categories/${category.id}`,
        { method: "DELETE", shopId: shop.id },
      ),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["category", shop.id, category.id] });
      await queryClient.invalidateQueries({ queryKey: categoriesKey(shop.id) });
      await queryClient.invalidateQueries({ queryKey: productsKey(shop.id) });
      await navigate({ to: "/$shop/kategorien", params: { shop: shop.handle } });
    },
  });
  return (
    <Card title="Kategorie löschen">
      <p className="text-sm text-gray-500">
        Die Produkte darin bleiben erhalten und sind danach ohne Kategorie.
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
                title: `Kategorie „${category.name}“ löschen?`,
                message: "Die Produkte darin bleiben erhalten.",
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
