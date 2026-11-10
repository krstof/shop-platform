// Bestellungen (M7): Liste neueste zuerst, Details mit „Als versendet markieren“.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Alert, Badge, Button, Card, Spinner } from "../components/ui.js";
import { ApiError, listAll, request, type Order, type OrderSummary } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

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
  const orders = useQuery({
    queryKey: ["orders", shop.id],
    queryFn: () => listAll<OrderSummary>("/admin/v1/orders", shop.id),
  });
  const open = orders.data?.filter((o) => o.status === "open").length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bestellungen</h1>
        {orders.data && (
          <p className="text-sm text-stone-500">
            {orders.data.length === 1 ? "1 Bestellung" : `${orders.data.length} Bestellungen`}
            {open > 0 && ` · ${open} zu versenden`}
          </p>
        )}
      </div>
      {orders.isPending && <Loading label="Bestellungen werden geladen …" />}
      {orders.isError && <Alert>{orders.error.message}</Alert>}
      {orders.data?.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-16 text-center">
          <p className="font-medium">Noch keine Bestellungen</p>
          <p className="mt-1 text-sm text-stone-500">
            Sobald jemand in deinem Shop kauft, erscheint es hier.
          </p>
        </div>
      )}
      {orders.data && orders.data.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
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
        {canShip && (
          <Button busy={ship.isPending} onClick={() => ship.mutate()}>
            Als versendet markieren
          </Button>
        )}
      </div>
      <div className="space-y-4" aria-live="polite">
        {ship.isError && <Alert>{ship.error.message}</Alert>}
        {ship.isSuccess && <Alert tone="success">Als versendet markiert. Die Bestellung ist erledigt.</Alert>}
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
              {o.paymentMethodName ?? "–"}: {o.paymentStatus === "paid" ? "bezahlt" : "noch offen"}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
