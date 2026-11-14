// Bestellung per Hand anlegen (15.11.2026, Kristof: Plus-Knopf in „Bestellungen“), etwa für eine
// telefonische Bestellung. Kunde wählen (angelegte Karten und frühere Besteller) oder eintippen,
// Artikel und Menge, „schon bezahlt“ und Versandkosten. Speichert über POST /admin/v1/orders; Preise,
// Steuern und Versand rechnet die API wie beim Kauf im Shop.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "../components/ui.js";
import { ApiError, listAll, request, type Product } from "../lib/api.js";
import type { CustomerSummary } from "../lib/customers.js";
import { formatEuro } from "../lib/money.js";
import { useCustomerProfiles } from "./customers.js";
import { useShop } from "./layout.js";
import { productsKey } from "./products.js";

interface Line {
  key: number;
  productId: string;
  quantity: string;
}

const EMPTY_CUSTOMER = { email: "", firstName: "", lastName: "", street: "", postalCode: "", city: "" };
type CustomerFields = typeof EMPTY_CUSTOMER;

/** Preis, zu dem der Shop gerade verkauft (Angebot zuerst). */
export function unitPrice(p: Pick<Product, "price" | "salePrice">): number {
  return p.salePrice?.amount ?? p.price?.amount ?? 0;
}

export function NewOrderPage() {
  const shop = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: productsKey(shop.id),
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });
  const profiles = useCustomerProfiles(shop.id);
  const buyers = useQuery({
    queryKey: ["customers", shop.id],
    queryFn: async () =>
      (await request<{ data: CustomerSummary[] }>("/admin/v1/customers", { shopId: shop.id })).data,
  });
  const sellable = (products.data ?? []).filter((p) => p.status === "published" && p.price !== null);
  const byId = new Map(sellable.map((p) => [p.id, p]));

  const [customer, setCustomer] = useState<CustomerFields>(EMPTY_CUSTOMER);
  const [chosen, setChosen] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: "", quantity: "1" }]);
  const [paid, setPaid] = useState(true);
  const [shipping, setShipping] = useState(true);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  // Auswahl „Kunde“: angelegte Karten (mit Adresse) und frühere Besteller (E-Mail und Name).
  const choices = [
    ...(profiles.data ?? []).map((p) => ({
      key: `karte:${p.id}`,
      label: `${p.firstName} ${p.lastName} · ${p.email}`,
      fill: {
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        street: p.address?.street ?? "",
        postalCode: p.address?.postalCode ?? "",
        city: p.address?.city ?? "",
      },
    })),
    ...(buyers.data ?? [])
      .filter((b) => !(profiles.data ?? []).some((p) => p.email.toLowerCase() === b.email.toLowerCase()))
      .map((b) => {
        const [first = "", ...rest] = b.name.split(" ");
        return {
          key: `kauf:${b.email}`,
          label: b.name ? `${b.name} · ${b.email}` : b.email,
          fill: { ...EMPTY_CUSTOMER, email: b.email, firstName: first, lastName: rest.join(" ") },
        };
      }),
  ];

  const ready = lines.filter((l) => byId.has(l.productId) && Number(l.quantity) >= 1);
  const subtotal = ready.reduce(
    (s, l) => s + unitPrice(byId.get(l.productId) as Product) * Number(l.quantity),
    0,
  );

  const save = useMutation({
    mutationFn: () =>
      request<{ id: string; orderNumber: string }>("/admin/v1/orders", {
        method: "POST",
        shopId: shop.id,
        body: {
          email: customer.email.trim(),
          address: {
            firstName: customer.firstName.trim(),
            lastName: customer.lastName.trim(),
            street: customer.street.trim(),
            postalCode: customer.postalCode.trim(),
            city: customer.city.trim(),
          },
          lines: ready.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
          paid,
          shipping,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
      }),
    onSuccess: async (o) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders", shop.id] }),
        queryClient.invalidateQueries({ queryKey: productsKey(shop.id) }),
        queryClient.invalidateQueries({ queryKey: ["customers", shop.id] }),
      ]);
      void navigate({ to: "/$shop/bestellungen/$orderId", params: { shop: shop.handle, orderId: o.id } });
    },
  });
  const apiError = save.error instanceof ApiError ? save.error : undefined;
  const missing = (k: keyof CustomerFields) => touched && customer[k].trim() === "";
  const problem =
    touched && ready.length === 0 ? "Bitte mindestens einen Artikel mit Menge auswählen." : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(customer).some((v) => v.trim() === "") || ready.length === 0) return;
    save.mutate();
  }

  const text = (k: keyof CustomerFields, label: string, type = "text") => (
    <Field
      label={`${label} *`}
      error={
        missing(k)
          ? "Bitte ausfüllen."
          : apiError?.field(k === "email" ? "/body/email" : `/body/address/${k}`)
      }
    >
      {(p) => (
        <Input
          {...p}
          type={type}
          autoComplete="off"
          value={customer[k]}
          onChange={(e) => setCustomer({ ...customer, [k]: e.target.value })}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/$shop/bestellungen"
            params={{ shop: shop.handle }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            ← Alle Bestellungen
          </Link>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-gray-900">
            Bestellung anlegen
          </h1>
          <p className="text-sm text-gray-500">Etwa für eine Bestellung per Telefon oder im Laden.</p>
        </div>
        <Button type="submit" busy={save.isPending}>
          Bestellung anlegen
        </Button>
      </div>

      {save.isError && (
        <div className="mb-4">
          <Alert>{save.error.message}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Artikel">
            {products.isPending && <p className="text-sm text-gray-500">Produkte werden geladen …</p>}
            {products.data && sellable.length === 0 && (
              <p className="text-sm text-gray-500">Es gibt noch keine Produkte im Shop.</p>
            )}
            <ul className="space-y-3">
              {lines.map((l, i) => {
                const p = byId.get(l.productId);
                return (
                  <li
                    key={l.key}
                    className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]"
                  >
                    <label className="min-w-0">
                      <span
                        className={i === 0 ? "mb-1.5 block text-sm font-medium text-gray-800" : "sr-only"}
                      >
                        Produkt
                      </span>
                      <Select
                        value={l.productId}
                        aria-label={`Produkt ${i + 1}`}
                        onChange={(e) =>
                          setLines(
                            lines.map((x) => (x.key === l.key ? { ...x, productId: e.target.value } : x)),
                          )
                        }
                      >
                        <option value="">Produkt wählen …</option>
                        {sellable.map((s) => (
                          <option key={s.id} value={s.id} disabled={s.stock <= 0}>
                            {s.name} · {formatEuro(unitPrice(s))}
                            {s.stock <= 0 ? " · ausverkauft" : ` · noch ${s.stock}`}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      <span
                        className={i === 0 ? "mb-1.5 block text-sm font-medium text-gray-800" : "sr-only"}
                      >
                        Menge
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={p?.stock ?? 999}
                        inputMode="numeric"
                        aria-label={`Menge ${i + 1}`}
                        value={l.quantity}
                        onChange={(e) =>
                          setLines(
                            lines.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)),
                          )
                        }
                      />
                    </label>
                    <span className="hidden pb-2 text-right text-sm tabular-nums sm:block">
                      {p ? formatEuro(unitPrice(p) * (Number(l.quantity) || 0)) : ""}
                    </span>
                    <button
                      type="button"
                      aria-label={`Artikel ${i + 1} entfernen`}
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                      className="mb-0.5 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-red-700 disabled:invisible"
                    >
                      <Trash className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() =>
                setLines([
                  ...lines,
                  { key: Math.max(...lines.map((x) => x.key)) + 1, productId: "", quantity: "1" },
                ])
              }
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
            >
              <Plus className="size-4" aria-hidden="true" /> Artikel hinzufügen
            </button>
            {problem && <p className="mt-2 text-sm text-red-700">{problem}</p>}
            <dl className="mt-4 flex justify-between border-t border-gray-100 pt-3 text-sm">
              <dt className="text-gray-600">Zwischensumme</dt>
              <dd className="font-medium tabular-nums">{formatEuro(subtotal)}</dd>
            </dl>
            <p className="mt-1 text-xs text-gray-500">
              Versandkosten und Steuern rechnet der Shop beim Anlegen wie im Shop aus.
            </p>
          </Card>

          <Card title="Kunde">
            {choices.length > 0 && (
              <div className="mb-4">
                <Field label="Kunde wählen" hint="Füllt die Felder aus; du kannst sie danach noch ändern.">
                  {(p) => (
                    <Select
                      {...p}
                      value={chosen}
                      onChange={(e) => {
                        setChosen(e.target.value);
                        const c = choices.find((x) => x.key === e.target.value);
                        setCustomer(c ? c.fill : EMPTY_CUSTOMER);
                      }}
                    >
                      <option value="">Neue Person eintippen</option>
                      {choices.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {text("firstName", "Vorname")}
                {text("lastName", "Nachname")}
              </div>
              {text("email", "E-Mail-Adresse", "email")}
              {text("street", "Straße und Hausnummer")}
              <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
                {text("postalCode", "Postleitzahl")}
                {text("city", "Stadt")}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Zahlung und Versand">
            <div className="space-y-3 text-sm">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={paid}
                  onChange={(e) => setPaid(e.target.checked)}
                />
                <span>
                  Schon bezahlt
                  <span className="block text-xs text-gray-500">
                    Etwa bar oder per Überweisung. Sonst wartet die Bestellung auf Zahlung.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={shipping}
                  onChange={(e) => setShipping(e.target.checked)}
                />
                <span>
                  Versandkosten berechnen
                  <span className="block text-xs text-gray-500">Aus: etwa bei Abholung im Laden.</span>
                </span>
              </label>
            </div>
          </Card>
          <Card title="Anmerkung">
            <Textarea
              rows={3}
              maxLength={500}
              aria-label="Anmerkung zur Bestellung"
              placeholder="Freiwillig, etwa „per Telefon bestellt“"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Card>
        </div>
      </div>
    </form>
  );
}
