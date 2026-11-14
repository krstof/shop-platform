// Übersicht (Startseite des Shops im Backoffice): Umsatz heute und der letzten 7 Tage, was zu tun
// ist (versenden, Zahlung offen, knapper Bestand) und die letzten Bestellungen.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Card, Spinner } from "../components/ui.js";
import { listAll, request, type OrderSummary, type Page, type Product } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";
import { StatusBadge } from "./orders.js";

export interface OrderStats {
  readonly currency: "EUR";
  readonly days: readonly { readonly date: string; readonly orders: number; readonly revenue: number }[];
  readonly toShip: number;
  readonly awaitingPayment: number;
}

/** Ab diesem Bestand gilt ein Produkt im Shop als knapp. */
export const LOW_STOCK = 5;

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", timeZone: "UTC" });
const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** „Fr“ und „14.11.“ für einen Tag wie „2026-11-14“. */
export function dayLabel(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T12:00:00Z`);
  return { weekday: WEEKDAY.format(d).replace(".", ""), day: DAY.format(d) };
}

/** Veröffentlichte Produkte mit wenig Bestand, knappste zuerst. */
export function lowStock(products: readonly Product[], limit = 5): Product[] {
  return products
    .filter((p) => p.status === "published" && p.stock <= LOW_STOCK)
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "de"))
    .slice(0, limit);
}

export function OverviewPage() {
  const shop = useShop();
  const stats = useQuery({
    queryKey: ["orders", shop.id, "kennzahlen"],
    queryFn: () => request<OrderStats>("/admin/v1/orders/summary", { shopId: shop.id }),
  });
  const recent = useQuery({
    queryKey: ["orders", shop.id, "neueste"],
    queryFn: () => request<Page<OrderSummary>>("/admin/v1/orders?limit=5", { shopId: shop.id }),
  });
  const products = useQuery({
    queryKey: ["products", shop.id, "liste", {}],
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });

  if (stats.isPending)
    return (
      <div className="flex justify-center py-16 text-stone-400" role="status">
        <Spinner className="size-6" />
        <span className="sr-only">Übersicht wird geladen …</span>
      </div>
    );
  if (stats.isError) return <Alert>{stats.error.message}</Alert>;
  const s = stats.data;
  const today = s.days.at(-1) ?? { date: "", orders: 0, revenue: 0 };
  const week = s.days.reduce((a, d) => ({ orders: a.orders + d.orders, revenue: a.revenue + d.revenue }), {
    orders: 0,
    revenue: 0,
  });
  const scarce = lowStock(products.data ?? []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Übersicht</h1>
        <p className="text-sm text-stone-500">Was heute in {shop.name} los ist.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile
          label="Umsatz heute"
          value={formatEuro(today.revenue)}
          note={count(today.orders, "Bestellung")}
        />
        <Tile
          label="Umsatz 7 Tage"
          value={formatEuro(week.revenue)}
          note={count(week.orders, "Bestellung")}
        />
        <Tile
          label="Zu versenden"
          value={String(s.toShip)}
          note={s.toShip > 0 ? "bezahlt, bitte versenden" : "alles verschickt"}
          to="versenden"
          highlight={s.toShip > 0}
        />
        <Tile
          label="Wartet auf Zahlung"
          value={String(s.awaitingPayment)}
          note="Testzahlung noch offen"
          to="zahlung"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Umsatz der letzten 7 Tage" className="lg:col-span-2">
          <RevenueChart days={s.days} />
        </Card>
        <Card title="Fast ausverkauft">
          {products.isPending && <Spinner />}
          {products.data && scarce.length === 0 && (
            <p className="text-sm text-stone-500">
              Alles gut: Kein Produkt im Shop hat {LOW_STOCK} Stück oder weniger.
            </p>
          )}
          {scarce.length > 0 && (
            <ul className="divide-y divide-stone-100">
              {scarce.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link
                    to="/$shop/produkte/$productId"
                    params={{ shop: shop.handle, productId: p.id }}
                    className="truncate font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span
                    className={
                      p.stock === 0 ? "shrink-0 font-medium text-red-700" : "shrink-0 text-stone-600"
                    }
                  >
                    {p.stock === 0 ? "ausverkauft" : `noch ${p.stock}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Neueste Bestellungen" className="mt-6">
        {recent.data?.data.length === 0 && (
          <p className="text-sm text-stone-500">
            Noch keine Bestellungen. Sobald jemand kauft, steht es hier.
          </p>
        )}
        {recent.data && recent.data.data.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {recent.data.data.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link
                    to="/$shop/bestellungen/$orderId"
                    params={{ shop: shop.handle, orderId: o.id }}
                    className="font-medium hover:underline"
                  >
                    Nr. {o.orderNumber}
                  </Link>
                  <p className="truncate text-xs text-stone-500">
                    {o.customerName || "–"} · {DATE.format(new Date(o.placedAt))}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row-reverse sm:items-center sm:gap-4">
                  <span className="tabular-nums">{formatEuro(o.total)}</span>
                  <StatusBadge order={o} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-sm">
          <Link
            to="/$shop/bestellungen"
            params={{ shop: shop.handle }}
            className="text-emerald-800 hover:underline"
          >
            Alle Bestellungen
          </Link>
        </div>
      </Card>
    </div>
  );
}

function count(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}en`;
}

function Tile({
  label,
  value,
  note,
  to,
  highlight = false,
}: {
  label: string;
  value: string;
  note: string;
  to?: "versenden" | "zahlung";
  highlight?: boolean;
}) {
  const shop = useShop();
  const body = (
    <>
      <p className="text-sm text-stone-500">{label}</p>
      <p
        className={
          "mt-1 text-xl font-semibold tabular-nums sm:text-2xl " +
          (highlight ? "text-emerald-800" : "text-stone-900")
        }
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-stone-500">{note}</p>
    </>
  );
  const box = "block rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200 sm:p-5";
  if (to === undefined) return <div className={box}>{body}</div>;
  return (
    <Link
      to="/$shop/bestellungen"
      params={{ shop: shop.handle }}
      search={{ stand: to }}
      className={box + " hover:ring-stone-300"}
    >
      {body}
    </Link>
  );
}

/** Ein Balken je Tag (eine Reihe, keine Legende nötig); Betrag beim Zeigen und für Screenreader. */
function RevenueChart({ days }: { days: OrderStats["days"] }) {
  const navigate = useNavigate();
  const shop = useShop();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.revenue), 1);
  return (
    <div>
      <div className="flex h-44 items-end gap-2 border-b border-stone-200 sm:gap-3" role="list">
        {days.map((d, i) => {
          const label = dayLabel(d.date);
          const height = d.revenue === 0 ? 0 : Math.max(4, Math.round((d.revenue / max) * 100));
          const text = `${label.weekday} ${label.day}: ${formatEuro(d.revenue)}, ${count(d.orders, "Bestellung")}`;
          return (
            <div
              key={d.date}
              role="listitem"
              aria-label={text}
              className="relative flex h-full flex-1 cursor-pointer items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => void navigate({ to: "/$shop/bestellungen", params: { shop: shop.handle } })}
            >
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-stone-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow">
                  {formatEuro(d.revenue)} · {count(d.orders, "Bestellung")}
                </div>
              )}
              <div
                className={
                  "w-full max-w-10 rounded-t " +
                  (i === days.length - 1 ? "bg-emerald-700" : "bg-emerald-600/70")
                }
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3" aria-hidden="true">
        {days.map((d, i) => {
          const label = dayLabel(d.date);
          return (
            <div key={d.date} className="flex-1 text-center text-xs text-stone-500">
              <div className={i === days.length - 1 ? "font-medium text-stone-800" : undefined}>
                {i === days.length - 1 ? "Heute" : label.weekday}
              </div>
              <div className="hidden sm:block">{label.day}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
