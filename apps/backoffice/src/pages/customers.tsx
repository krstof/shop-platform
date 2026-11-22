// Kundinnen und Kunden: alle, die bestellt haben, je E-Mail zusammengefasst (API /admin/v1/customers),
// dazu per Hand angelegte Kundenkarten (API /admin/v1/customer-profiles, 15.11.2026: Plus-Button).
// Klick zeigt ihre Bestellungen (Bestellliste mit Suche nach der E-Mail).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trash } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useConfirm, Modal } from "../components/dialog.js";
import { Alert, Button, Field, Input, Spinner } from "../components/ui.js";
import { ApiError, request } from "../lib/api.js";
import {
  filterCustomers,
  mergeCustomers,
  type CustomerProfile,
  type CustomerSummary,
} from "../lib/customers.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

export const profilesKey = (shopId: string) => ["customer-profiles", shopId] as const;

export function useCustomerProfiles(shopId: string) {
  return useQuery({
    queryKey: profilesKey(shopId),
    queryFn: async () =>
      (await request<{ data: CustomerProfile[] }>("/admin/v1/customer-profiles", { shopId })).data,
  });
}

export function CustomersPage() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const summaries = useQuery({
    queryKey: ["customers", shop.id],
    queryFn: async () =>
      (await request<{ data: CustomerSummary[] }>("/admin/v1/customers", { shopId: shop.id })).data,
  });
  const profiles = useCustomerProfiles(shop.id);
  const customers = {
    isPending: summaries.isPending || profiles.isPending,
    isError: summaries.isError || profiles.isError,
    error: summaries.error ?? profiles.error,
    data: summaries.data && profiles.data ? mergeCustomers(summaries.data, profiles.data) : undefined,
  };
  const shown = filterCustomers(customers.data ?? [], text);
  const remove = useMutation({
    mutationFn: (p: CustomerProfile) =>
      request(`/admin/v1/customer-profiles/${p.id}`, { method: "DELETE", shopId: shop.id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: profilesKey(shop.id) }),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Kunden</h1>
          {customers.data && (
            <p className="text-sm text-gray-500" aria-live="polite">
              {text.trim() === ""
                ? `${customers.data.length} ${customers.data.length === 1 ? "Kundin oder Kunde" : "Kundinnen und Kunden"}`
                : `${shown.length} Treffer`}
            </p>
          )}
        </div>
        <Button onClick={() => setAdding(true)}>
          <span aria-hidden="true">+</span> Kunde anlegen
        </Button>
      </div>
      <NewCustomerDialog open={adding} onClose={() => setAdding(false)} />
      <label className="mb-4 block" role="search">
        <span className="sr-only">Kunden suchen</span>
        <Input
          type="search"
          value={text}
          maxLength={100}
          placeholder="Suchen nach Name oder E-Mail"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {customers.isPending && (
        <div className="flex justify-center py-16 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Kunden werden geladen …</span>
        </div>
      )}
      {customers.isError && <Alert>{customers.error?.message}</Alert>}
      {customers.data?.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Kunden</p>
          <p className="mt-1 text-sm text-gray-500">
            Sobald jemand bestellt, erscheint die Person hier. Oder oben „Kunde anlegen“.
          </p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Kunde
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Bestellungen
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                  Umsatz
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Zuletzt
                </th>
                <th scope="col" className="w-10 px-2 py-3">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((c) => (
                <tr key={c.email.toLowerCase()}>
                  <td className="px-4 py-3">
                    <Link
                      to="/$shop/bestellungen"
                      params={{ shop: shop.handle }}
                      search={{ suche: c.email }}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {c.name || c.email}
                    </Link>
                    {c.profile && c.orderCount === 0 && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        angelegt
                      </span>
                    )}
                    <div className="truncate text-xs text-gray-500">
                      {c.email}
                      {c.profile?.phone ? ` · ${c.profile.phone}` : ""}
                      {c.profile?.address
                        ? ` · ${c.profile.address.postalCode} ${c.profile.address.city}`
                        : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orderCount}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {formatEuro(c.revenue)}
                  </td>
                  <td className="hidden px-4 py-3 text-gray-600 md:table-cell">
                    {c.lastOrderAt === null ? "noch nie bestellt" : DATE.format(new Date(c.lastOrderAt))}
                  </td>
                  <td className="px-2 py-3 text-right">
                    {c.profile && (
                      <button
                        type="button"
                        aria-label={`Kundenkarte ${c.name || c.email} löschen`}
                        title="Kundenkarte löschen"
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-700"
                        onClick={async () => {
                          const p = c.profile;
                          if (
                            p &&
                            (await confirm({
                              title: "Kundenkarte löschen?",
                              message: `Die Karte von ${c.name || c.email} wird gelöscht. Bestellungen bleiben erhalten.`,
                              confirmLabel: "Löschen",
                              tone: "danger",
                            }))
                          )
                            remove.mutate(p);
                        }}
                      >
                        <Trash className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {customers.data && customers.data.length > 0 && shown.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-500">Niemand passt zur Suche.</p>
      )}
    </div>
  );
}

const EMPTY = { firstName: "", lastName: "", email: "", phone: "", street: "", postalCode: "", city: "" };

/** Kunde per Hand anlegen: Name und E-Mail Pflicht, Telefon und Adresse freiwillig. */
function NewCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shop = useShop();
  const queryClient = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const hasAddress = f.street.trim() !== "" || f.postalCode.trim() !== "" || f.city.trim() !== "";
      return request<CustomerProfile>("/admin/v1/customer-profiles", {
        method: "POST",
        shopId: shop.id,
        body: {
          firstName: f.firstName.trim(),
          lastName: f.lastName.trim(),
          email: f.email.trim(),
          ...(f.phone.trim() === "" ? {} : { phone: f.phone.trim() }),
          ...(hasAddress
            ? { address: { street: f.street.trim(), postalCode: f.postalCode.trim(), city: f.city.trim() } }
            : {}),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profilesKey(shop.id) });
      close();
    },
  });
  function close() {
    setF(EMPTY);
    setTouched(false);
    save.reset();
    onClose();
  }
  const err = save.error instanceof ApiError ? save.error : undefined;
  const required = (k: "firstName" | "lastName" | "email") => touched && f[k].trim() === "";
  const field = (k: keyof typeof EMPTY, label: string, type = "text", auto?: string) => (
    <Field
      label={label}
      error={
        (k === "firstName" || k === "lastName" || k === "email") && required(k)
          ? "Bitte ausfüllen."
          : err?.field(`/body/${k === "street" || k === "postalCode" || k === "city" ? `address/${k}` : k}`)
      }
    >
      {(p) => (
        <Input
          {...p}
          type={type}
          autoComplete={auto}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      )}
    </Field>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (f.firstName.trim() === "" || f.lastName.trim() === "" || f.email.trim() === "") return;
    save.mutate();
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Kunde anlegen"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Abbrechen
          </Button>
          <Button type="submit" form="kunde-neu" busy={save.isPending}>
            Anlegen
          </Button>
        </>
      }
    >
      <form id="kunde-neu" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("firstName", "Vorname *", "text", "off")}
          {field("lastName", "Nachname *", "text", "off")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("email", "E-Mail-Adresse *", "email", "off")}
          {field("phone", "Telefon", "tel", "off")}
        </div>
        <p className="pt-1 text-sm font-medium text-gray-800">Lieferadresse (freiwillig)</p>
        {field("street", "Straße und Hausnummer", "text", "off")}
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          {field("postalCode", "Postleitzahl", "text", "off")}
          {field("city", "Stadt", "text", "off")}
        </div>
        {save.isError && (
          <Alert>
            {err?.status === 409 ? "Diese E-Mail-Adresse gibt es schon in den Kunden." : save.error.message}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
