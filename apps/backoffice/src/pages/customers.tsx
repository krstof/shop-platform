// Kundinnen und Kunden: alle, die bestellt haben, je E-Mail zusammengefasst (API /admin/v1/customers).
// Klick zeigt ihre Bestellungen (Bestellliste mit Suche nach der E-Mail).
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Input, Spinner } from "../components/ui.js";
import { request } from "../lib/api.js";
import { filterCustomers, type CustomerSummary } from "../lib/customers.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

export function CustomersPage() {
  const shop = useShop();
  const [text, setText] = useState("");
  const customers = useQuery({
    queryKey: ["customers", shop.id],
    queryFn: async () =>
      (await request<{ data: CustomerSummary[] }>("/admin/v1/customers", { shopId: shop.id })).data,
  });
  const shown = filterCustomers(customers.data ?? [], text);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Kunden</h1>
        {customers.data && (
          <p className="text-sm text-stone-500" aria-live="polite">
            {text.trim() === ""
              ? `${customers.data.length} ${customers.data.length === 1 ? "Kundin oder Kunde" : "Kundinnen und Kunden"}`
              : `${shown.length} Treffer`}{" "}
            · alle, die schon bestellt haben
          </p>
        )}
      </div>
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
        <div className="flex justify-center py-16 text-stone-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Kunden werden geladen …</span>
        </div>
      )}
      {customers.isError && <Alert>{customers.error.message}</Alert>}
      {customers.data?.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Kunden</p>
          <p className="mt-1 text-sm text-stone-500">Sobald jemand bestellt, erscheint die Person hier.</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shown.map((c) => (
                <tr key={c.email.toLowerCase()}>
                  <td className="px-4 py-3">
                    <Link
                      to="/$shop/bestellungen"
                      params={{ shop: shop.handle }}
                      search={{ suche: c.email }}
                      className="font-medium text-stone-900 hover:underline"
                    >
                      {c.name || c.email}
                    </Link>
                    <div className="truncate text-xs text-stone-500">{c.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orderCount}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {formatEuro(c.revenue)}
                  </td>
                  <td className="hidden px-4 py-3 text-stone-600 md:table-cell">
                    {DATE.format(new Date(c.lastOrderAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {customers.data && customers.data.length > 0 && shown.length === 0 && (
        <p className="py-10 text-center text-sm text-stone-500">Niemand passt zur Suche.</p>
      )}
    </div>
  );
}
