// Bestellungen (M7): Liste neueste zuerst, Details mit „Als versendet markieren“.
// Suche und Filter nach Stand (14.11.2026) stehen in der Adresse und gehen als Filter an die Admin-API.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Input, Select, Spinner } from "../components/ui.js";
import { ApiError, listAll, request, type Order, type OrderSummary } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import {
  isOrderFiltered,
  orderListPath,
  ordersCsv,
  parseOrderFilter,
  type OrderFilter,
  type OrderStateFilter,
} from "../lib/order-filter.js";
import { useShop } from "./layout.js";
import { productsKey } from "./products.js";

/** Filter beim Ändern: ein Feld auf `undefined` setzen heißt „nicht filtern“. */
type FilterInput = { [K in keyof OrderFilter]?: OrderFilter[K] | undefined };

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** Stand als Text (für die CSV-Datei). */
export function stateText(o: { status: string; paymentStatus: string }): string {
  if (o.status === "pending_payment") return "Wartet auf Zahlung";
  if (o.status === "cancelled") return "Storniert";
  if (o.status === "completed") return "Versendet";
  return "Bezahlt – zu versenden";
}

/** Lädt die gerade gezeigte Liste als CSV-Datei herunter (für Excel oder Numbers). */
function downloadCsv(orders: readonly OrderSummary[], shopHandle: string) {
  const blob = new Blob([ordersCsv(orders, stateText)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bestellungen-${shopHandle}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ein Wort für den Stand, wie Händler ihn verstehen. */
export function StatusBadge({ order }: { order: Pick<OrderSummary, "status" | "fulfillmentStatus"> }) {
  if (order.status === "pending_payment") return <Badge tone="amber">Wartet auf Zahlung</Badge>;
  if (order.status === "cancelled") return <Badge tone="stone">Storniert</Badge>;
  if (order.fulfillmentStatus === "shipped" || order.status === "completed")
    return <Badge tone="stone">Versendet</Badge>;
  return <Badge tone="green">Bezahlt – bitte versenden</Badge>;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-16 text-stone-400" role="status">
      <Spinner className="size-6" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function OrdersPage() {
  const shop = useShop();
  const navigate = useNavigate();
  const filter = useSearch({ from: "/$shop/bestellungen" });
  const filtered = isOrderFiltered(filter);
  const orders = useQuery({
    queryKey: ["orders", shop.id, "liste", filter],
    queryFn: () => listAll<OrderSummary>(orderListPath(filter), shop.id),
    placeholderData: keepPreviousData,
  });
  // „N zu versenden“ immer über alle Bestellungen, nicht nur über die gefilterten.
  const toShip = useQuery({
    queryKey: ["orders", shop.id, "zu-versenden"],
    queryFn: () => listAll<OrderSummary>(orderListPath({ stand: "versenden" }), shop.id),
  });
  const open = toShip.data?.length ?? 0;
  const count = orders.data?.length ?? 0;

  const setFilter = useCallback(
    (next: FilterInput) =>
      void navigate({
        to: "/$shop/bestellungen",
        params: { shop: shop.handle },
        search: parseOrderFilter({ ...next }),
        replace: true,
      }),
    [navigate, shop.handle],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bestellungen</h1>
          {orders.data && (
            <p className="text-sm text-stone-500" aria-live="polite">
              {filtered
                ? count === 1
                  ? "1 Treffer"
                  : `${count} Treffer`
                : count === 1
                  ? "1 Bestellung"
                  : `${count} Bestellungen`}
              {open > 0 && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="text-emerald-800 hover:underline"
                    onClick={() => setFilter({ stand: "versenden" })}
                  >
                    {open} zu versenden
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {orders.data && orders.data.length > 0 && (
          <Button variant="secondary" onClick={() => downloadCsv(orders.data, shop.handle)}>
            Als Tabelle herunterladen
          </Button>
        )}
      </div>
      <OrderFilterBar filter={filter} onChange={setFilter} />
      {orders.isPending && <Loading label="Bestellungen werden geladen …" />}
      {orders.isError && <Alert>{orders.error.message}</Alert>}
      {orders.data?.length === 0 && filtered && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Keine Bestellungen gefunden</p>
          <p className="mt-1 text-sm text-stone-500">Keine Bestellung passt zu Suche und Filter.</p>
          <Button variant="secondary" className="mt-4" onClick={() => setFilter({})}>
            Filter zurücksetzen
          </Button>
        </div>
      )}
      {orders.data?.length === 0 && !filtered && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Bestellungen</p>
          <p className="mt-1 text-sm text-stone-500">
            Sobald jemand in deinem Shop kauft, erscheint es hier.
          </p>
        </div>
      )}
      {orders.data && orders.data.length > 0 && (
        <div
          className={
            "overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200 transition-opacity" +
            (orders.isPlaceholderData ? " opacity-60" : "")
          }
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Bestellung
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Datum
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Kunde
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  Stand
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Summe
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.data.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer hover:bg-stone-50"
                  onClick={() =>
                    void navigate({
                      to: "/$shop/bestellungen/$orderId",
                      params: { shop: shop.handle, orderId: o.id },
                    })
                  }
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/$shop/bestellungen/$orderId"
                      params={{ shop: shop.handle, orderId: o.id }}
                      className="font-medium text-stone-900 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Nr. {o.orderNumber}
                    </Link>
                    <div className="mt-1 sm:hidden">
                      <StatusBadge order={o} />
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-stone-600 md:table-cell">
                    {DATE.format(new Date(o.placedAt))}
                  </td>
                  <td className="px-4 py-3">
                    <div>{o.customerName || "–"}</div>
                    <div className="text-xs text-stone-500">
                      {o.itemCount === 1 ? "1 Artikel" : `${o.itemCount} Artikel`}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <StatusBadge order={o} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatEuro(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Suchfeld plus Auswahl für den Stand. Die Suche wartet kurz, bis man aufhört zu tippen. */
function OrderFilterBar({
  filter,
  onChange,
}: {
  filter: OrderFilter;
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
        <span className="sr-only">Bestellungen suchen</span>
        <Input
          type="search"
          value={text}
          maxLength={100}
          placeholder="Suchen nach Bestellnummer, Name oder E-Mail"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="sm:w-56">
        <span className="sr-only">Stand</span>
        <Select
          value={filter.stand ?? ""}
          onChange={(e) =>
            onChange({ ...filter, stand: (e.target.value || undefined) as OrderStateFilter | undefined })
          }
        >
          <option value="">Alle</option>
          <option value="zahlung">Wartet auf Zahlung</option>
          <option value="versenden">Bezahlt – zu versenden</option>
          <option value="versendet">Versendet</option>
          <option value="storniert">Storniert</option>
        </Select>
      </label>
    </div>
  );
}

export function OrderPage() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const { orderId } = useParams({ strict: false });
  const key = ["order", shop.id, orderId];
  const order = useQuery({
    queryKey: key,
    queryFn: () => request<Order>(`/admin/v1/orders/${orderId ?? ""}`, { shopId: shop.id }),
  });
  const ship = useMutation({
    mutationFn: () =>
      request<Order>(`/admin/v1/orders/${orderId ?? ""}/ship`, { method: "POST", shopId: shop.id }),
    onSuccess: (o) => {
      queryClient.setQueryData(key, o);
      void queryClient.invalidateQueries({ queryKey: ["orders", shop.id] });
    },
  });

  const cancel = useMutation({
    mutationFn: () =>
      request<Order>(`/admin/v1/orders/${orderId ?? ""}/cancel`, { method: "POST", shopId: shop.id }),
    onSuccess: (o) => {
      queryClient.setQueryData(key, o);
      void queryClient.invalidateQueries({ queryKey: ["orders", shop.id] });
      // Bestand der Produkte hat sich geändert.
      void queryClient.invalidateQueries({ queryKey: productsKey(shop.id) });
    },
  });

  if (order.isPending) return <Loading label="Bestellung wird geladen …" />;
  if (order.isError)
    return (
      <Alert>
        {order.error instanceof ApiError && order.error.status === 404
          ? "Diese Bestellung gibt es nicht."
          : order.error.message}
      </Alert>
    );
  const o = order.data;
  const canShip = o.status === "open" && o.paymentStatus === "paid" && o.fulfillmentStatus === "unfulfilled";
  const canCancel = o.status !== "cancelled" && o.fulfillmentStatus === "unfulfilled";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/$shop/bestellungen"
            params={{ shop: shop.handle }}
            className="text-sm text-stone-500 hover:text-stone-800"
          >
            ← Alle Bestellungen
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            Bestellung {o.orderNumber} <StatusBadge order={o} />
          </h1>
          <p className="text-sm text-stone-500">{DATE.format(new Date(o.placedAt))}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCancel && (
            <Button
              variant="secondary"
              busy={cancel.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Bestellung ${o.orderNumber} stornieren? Die Ware kommt zurück ins Lager${
                      o.paymentStatus === "paid" ? ", die Testzahlung gilt als erstattet" : ""
                    }. Das lässt sich nicht rückgängig machen.`,
                  )
                )
                  cancel.mutate();
              }}
            >
              Stornieren
            </Button>
          )}
          {canShip && (
            <Button busy={ship.isPending} onClick={() => ship.mutate()}>
              Als versendet markieren
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-4" aria-live="polite">
        {ship.isError && <Alert>{ship.error.message}</Alert>}
        {ship.isSuccess && <Alert tone="success">Als versendet markiert. Die Bestellung ist erledigt.</Alert>}
        {cancel.isError && <Alert>{cancel.error.message}</Alert>}
        {cancel.isSuccess && (
          <Alert tone="success">Storniert. Die Ware ist wieder im Lager und im Shop bestellbar.</Alert>
        )}
        {o.status === "pending_payment" && (
          <Alert tone="info">
            Die Zahlung fehlt noch. Erst nach der Zahlung kann die Bestellung versendet werden.
          </Alert>
        )}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card title="Artikel" className="lg:col-span-2">
          <ul className="divide-y divide-stone-100">
            {o.lines.map((l) => (
              <li key={l.position} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                <div>
                  <Link
                    to="/$shop/produkte/$productId"
                    params={{ shop: shop.handle, productId: l.productId }}
                    className="font-medium hover:underline"
                  >
                    {l.name}
                  </Link>
                  <div className="text-xs text-stone-500">
                    {l.quantity} × {formatEuro(l.unitPrice)} · {l.taxRatePercent} % MwSt.
                    {l.sku && ` · Art.-Nr. ${l.sku}`}
                  </div>
                </div>
                <span className="tabular-nums">{formatEuro(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-stone-200 pt-4 text-sm">
            <dt className="text-stone-600">Zwischensumme</dt>
            <dd className="text-right tabular-nums">{formatEuro(o.subtotal)}</dd>
            <dt className="text-stone-600">Versand</dt>
            <dd className="text-right tabular-nums">
              {o.shipping === 0 ? "kostenlos" : formatEuro(o.shipping)}
            </dd>
            <dt className="font-semibold">Gesamt</dt>
            <dd className="text-right font-semibold tabular-nums">{formatEuro(o.total)}</dd>
            {Object.entries(o.taxByRate).map(([rate, cents]) => (
              <div key={rate} className="contents text-xs text-stone-500">
                <dt>enthaltene MwSt. {rate} %</dt>
                <dd className="text-right tabular-nums">{formatEuro(cents)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <div className="space-y-6">
          <Card title="Kunde">
            <p className="text-sm">
              {o.address.firstName} {o.address.lastName}
              <br />
              <a href={`mailto:${o.email}`} className="text-emerald-800 hover:underline">
                {o.email}
              </a>
            </p>
          </Card>
          <Card title="Lieferadresse">
            <address className="text-sm not-italic">
              {o.address.firstName} {o.address.lastName}
              <br />
              {o.address.street}
              <br />
              {o.address.postalCode} {o.address.city}
              <br />
              Deutschland
            </address>
          </Card>
          <Card title="Zahlung">
            <p className="text-sm">
              {o.paymentMethodName ?? "–"}:{" "}
              {o.paymentStatus === "paid"
                ? "bezahlt"
                : o.paymentStatus === "refunded"
                  ? "erstattet (storniert)"
                  : o.status === "cancelled"
                    ? "storniert"
                    : "noch offen"}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
