// Analytics (Paket P3, Kristof 22.11.2026): eine Seite unter „Onlineshop" mit den Zahlen des Shops
// über einen wählbaren Zeitraum — Umsatz, Bestellungen, durchschnittlicher Warenkorb und
// Seitenaufrufe, dazu die meistverkauften Produkte und die meistbesuchten Seiten.
//
// Die Seitenaufrufe zählt der Server der Storefront selbst: ohne Cookie, ohne JavaScript im
// Browser, ohne fremden Dienst. Deshalb steht hier „Aufrufe" und nicht „Besucher": Wer ohne
// Wiedererkennung zählt, kann zwei Aufrufe derselben Person nicht zusammenfassen — und
// Wiedererkennung wäre genau das, was man auf einer Seite ohne Cookie-Banner nicht haben will.
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Eye, ShoppingBag, Wallet } from "lucide-react";
import { useState, type ComponentType } from "react";
import { Alert, Card, Spinner } from "../components/ui.js";
import { request } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";
import type { OrderStats } from "./overview.js";

/** Zahlen mit Tausenderpunkt, wie man sie auf Deutsch schreibt. */
const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(n);

/** „1 Aufruf“, „1.500 Aufrufe“. */
function anzahl(n: number, einzahl: string, mehrzahl: string): string {
  return n === 1 ? `1 ${einzahl}` : `${zahl(n)} ${mehrzahl}`;
}

/** Zeiträume zur Auswahl. Mehr als ein Jahr nimmt die API nicht. */
const ZEITRAEUME = [
  { tage: 7, name: "7 Tage" },
  { tage: 30, name: "30 Tage" },
  { tage: 90, name: "90 Tage" },
] as const;

interface PageViews {
  readonly days: readonly { readonly date: string; readonly views: number }[];
  readonly pages: readonly { readonly path: string; readonly kind: string; readonly views: number }[];
  readonly total: number;
}

interface TopProducts {
  readonly currency: "EUR";
  readonly products: readonly {
    readonly productId: string;
    readonly name: string;
    readonly quantity: number;
    readonly revenue: number;
  }[];
}

const ART_NAMEN: Record<string, string> = {
  start: "Startseite",
  produkt: "Produkt",
  kategorie: "Kategorie",
  seite: "Eigene Seite",
  sonstige: "Sonstige",
};

export function AnalyticsPage() {
  const shop = useShop();
  const [tage, setTage] = useState<number>(30);

  const umsatz = useQuery({
    queryKey: ["analytics-orders", shop.id, tage] as const,
    queryFn: () => request<OrderStats>(`/admin/v1/orders/summary?days=${tage}`, { shopId: shop.id }),
  });
  const aufrufe = useQuery({
    queryKey: ["analytics-views", shop.id, tage] as const,
    queryFn: () => request<PageViews>(`/admin/v1/analytics/views?days=${tage}`, { shopId: shop.id }),
  });
  const produkte = useQuery({
    queryKey: ["analytics-top", shop.id, tage] as const,
    queryFn: () => request<TopProducts>(`/admin/v1/orders/top-products?days=${tage}`, { shopId: shop.id }),
  });

  const tageUmsatz: OrderStats["days"] = umsatz.data?.days ?? [];
  const summeUmsatz = tageUmsatz.reduce((n, d) => n + d.revenue, 0);
  const summeBestellungen = tageUmsatz.reduce((n, d) => n + d.orders, 0);
  const warenkorb = summeBestellungen === 0 ? 0 : Math.round(summeUmsatz / summeBestellungen);
  const fehler = umsatz.isError || aufrufe.isError || produkte.isError;
  const laedt = umsatz.isPending || aufrufe.isPending || produkte.isPending;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
          <p className="mt-1 text-[0.95rem] text-gray-600">
            Wie dein Shop läuft: Umsatz, Bestellungen und Aufrufe im gewählten Zeitraum.
          </p>
        </div>
        <div className="flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Zeitraum">
          {ZEITRAEUME.map((z) => (
            <button
              key={z.tage}
              type="button"
              aria-pressed={tage === z.tage}
              onClick={() => setTage(z.tage)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition " +
                (tage === z.tage ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")
              }
            >
              {z.name}
            </button>
          ))}
        </div>
      </div>

      {fehler && <Alert tone="error">Die Zahlen ließen sich nicht laden.</Alert>}
      {laedt && !fehler && <Spinner />}

      {!laedt && !fehler && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kennzahl icon={Wallet} farbe="#0d8f7f" name="Umsatz" wert={formatEuro(summeUmsatz)} />
            <Kennzahl icon={ShoppingBag} farbe="#3354e0" name="Bestellungen" wert={zahl(summeBestellungen)} />
            <Kennzahl
              icon={BarChart3}
              farbe="#7c3aed"
              name="Ø Warenkorb"
              wert={formatEuro(warenkorb)}
              hinweis={summeBestellungen === 0 ? "noch keine Bestellung" : undefined}
            />
            <Kennzahl icon={Eye} farbe="#d9822b" name="Seitenaufrufe" wert={zahl(aufrufe.data?.total ?? 0)} />
          </div>

          <Card title="Umsatz je Tag">
            <Verlauf
              werte={tageUmsatz.map((d) => ({ date: d.date, wert: d.revenue }))}
              beschriftung={(d) => `${formatEuro(d.wert)}`}
              farbe="bg-brand-600"
            />
          </Card>

          <Card title="Seitenaufrufe je Tag">
            <Verlauf
              werte={(aufrufe.data?.days ?? []).map((d) => ({ date: d.date, wert: d.views }))}
              beschriftung={(d) => anzahl(d.wert, "Aufruf", "Aufrufe")}
              farbe="bg-amber-500"
            />
            {(aufrufe.data?.total ?? 0) === 0 && (
              <p className="mt-4 text-sm text-gray-600">
                Noch keine Aufrufe gezählt. Öffne deinen Shop und lade ein paar Seiten; hier stehen sie eine
                Minute später.
              </p>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Meistverkaufte Produkte">
              {(produkte.data?.products.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-600">In diesem Zeitraum wurde nichts verkauft.</p>
              ) : (
                <Tabelle
                  kopf={["Produkt", "Stück", "Umsatz"]}
                  zeilen={(produkte.data?.products ?? []).map((p) => [
                    p.name,
                    zahl(p.quantity),
                    formatEuro(p.revenue),
                  ])}
                />
              )}
            </Card>
            <Card title="Meistbesuchte Seiten">
              {(aufrufe.data?.pages.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-600">Noch keine Aufrufe gezählt.</p>
              ) : (
                <Tabelle
                  kopf={["Seite", "Art", "Aufrufe"]}
                  zeilen={(aufrufe.data?.pages ?? []).map((p) => [
                    p.path,
                    ART_NAMEN[p.kind] ?? p.kind,
                    zahl(p.views),
                  ])}
                />
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Kennzahl({
  icon: Icon,
  farbe,
  name,
  wert,
  hinweis,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  farbe: string;
  name: string;
  wert: string;
  hinweis?: string | undefined;
}) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-md"
          style={{ backgroundColor: `${farbe}1a`, color: farbe }}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="text-sm text-gray-600">{name}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900 tabular-nums">{wert}</p>
      {hinweis !== undefined && <p className="text-xs text-gray-500">{hinweis}</p>}
    </div>
  );
}

/**
 * Ein Balken je Tag. Bei 90 Tagen werden die Balken dünn und nur jede zweite Woche bekommt eine
 * Beschriftung; den genauen Wert zeigt der Hinweis beim Zeigen und liest der Screenreader vor.
 */
function Verlauf({
  werte,
  beschriftung,
  farbe,
}: {
  werte: readonly { readonly date: string; readonly wert: number }[];
  beschriftung: (d: { date: string; wert: number }) => string;
  farbe: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...werte.map((w) => w.wert), 1);
  const schritt = werte.length <= 10 ? 1 : werte.length <= 31 ? 7 : 14;
  const tagText = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(d);
  };
  return (
    <div>
      <div className="flex h-40 items-end gap-px border-b border-gray-200 sm:gap-0.5" role="list">
        {werte.map((w, i) => {
          const hoehe = w.wert === 0 ? 0 : Math.max(3, Math.round((w.wert / max) * 100));
          return (
            <div
              key={w.date}
              role="listitem"
              aria-label={`${tagText(w.date)}: ${beschriftung(w)}`}
              className="relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow">
                  {tagText(w.date)}: {beschriftung(w)}
                </div>
              )}
              <div
                className={`w-full rounded-t ${farbe} ${w.wert === 0 ? "opacity-20" : hover === i ? "" : "opacity-80"}`}
                style={{ height: `${Math.max(hoehe, 2)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-px sm:gap-0.5" aria-hidden="true">
        {werte.map((w, i) => (
          <div key={w.date} className="flex-1 text-center text-[0.65rem] text-gray-500">
            {i === werte.length - 1 ? "heute" : (werte.length - 1 - i) % schritt === 0 ? tagText(w.date) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tabelle({ kopf, zeilen }: { kopf: readonly string[]; zeilen: readonly (readonly string[])[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
          {kopf.map((k, i) => (
            <th key={k} className={"pb-2 font-medium " + (i === 0 ? "" : "text-right")}>
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z, i) => (
          <tr key={i} className="border-b border-gray-100 last:border-0">
            {z.map((wert, j) => (
              <td
                key={j}
                className={
                  "py-2 " + (j === 0 ? "pr-3 text-gray-900" : "text-right text-gray-600 tabular-nums")
                }
              >
                {j === 0 ? <span className="line-clamp-1">{wert}</span> : wert}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
