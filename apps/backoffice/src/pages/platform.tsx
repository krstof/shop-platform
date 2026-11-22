// Plattform-Verwaltung (M8): Shops auflisten, anlegen (lädt die Inhaberin ein), sperren und wieder
// freischalten, darüber Kennzahlen aller Shops (Umsatz, Bestellungen, offene Aufgaben). Nur für
// Betreiberkonten. Seit dem 22.11.2026 ohne Pflicht zum zweiten Faktor (Entscheidung Kristof:
// privates Testsystem); die Endpunkte dafür gibt es in der Auth-API weiter.
// Nutzt nur die Platform-API und die Auth-API, nie eine Shop-Id.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Field, Input, Spinner } from "../components/ui.js";
import {
  ApiError,
  listAllPlatform,
  request,
  type CreatedPlatformShop,
  type OperatorRole,
  type PlatformShop,
  type PlatformStats,
} from "../lib/api.js";
import { handleFromName } from "../lib/handle.js";
import { formatEuro } from "../lib/money.js";
import { dayLabel } from "./overview.js";
import { Clock, Euro, PackageCheck, Store, TrendingUp } from "lucide-react";
import { sessionKey, useSession } from "../lib/session.js";
import { FullPageSpinner, SignOutButton } from "./layout.js";
import { SlopifyLogo } from "../components/logo.js";
import { useConfirm } from "../components/dialog.js";

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const DATE_TIME = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** Adresse einer anderen Oberfläche derselben Plattform, etwa shop.<Domain> neben admin.<Domain>. */
function siblingOrigin(sub: "shop" | "mail"): string {
  const host = window.location.host.replace(/^admin\./, `${sub}.`);
  return `${window.location.protocol}//${host}`;
}

export function PlatformPage() {
  const session = useSession();
  if (session.isPending) return <FullPageSpinner />;
  if (!session.data) return <Navigate to="/anmelden" replace />;
  const s = session.data;
  if (!s.platformOperator)
    return (
      <PlatformFrame email={s.user.email}>
        <Alert>Dieses Konto ist kein Betreiberkonto. Die Plattform-Verwaltung ist nur für den Betrieb.</Alert>
      </PlatformFrame>
    );
  return (
    <PlatformFrame email={s.user.email} hasShops={s.shops.length > 0} firstShop={s.shops[0]?.handle}>
      <ShopsAdmin />
    </PlatformFrame>
  );
}

function PlatformFrame({
  email,
  firstShop,
  hasShops = false,
  children,
}: {
  email: string;
  firstShop?: string | undefined;
  hasShops?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/plattform" className="flex items-center gap-2 font-semibold text-gray-900">
            <SlopifyLogo />
            <span className="rounded-md bg-gray-900 px-2 py-0.5 text-xs font-medium tracking-wide text-white">
              Betrieb
            </span>
            <span className="hidden sm:inline">Plattform-Verwaltung</span>
          </Link>
          {hasShops && firstShop !== undefined && (
            <Link
              to="/$shop/dashboard"
              params={{ shop: firstShop }}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Zu meinem Shop
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-gray-500 sm:inline">{email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

// --- Shops ---

const shopsKey = ["platform", "shops"] as const;
const statsKey = ["platform", "stats"] as const;

function ShopsAdmin() {
  const queryClient = useQueryClient();
  const operator = useQuery({
    queryKey: ["platform", "operator"],
    queryFn: () => request<{ userId: string; role: OperatorRole }>("/platform/v1/operator"),
  });
  const shops = useQuery({
    queryKey: shopsKey,
    queryFn: () => listAllPlatform<PlatformShop>("/platform/v1/shops"),
  });
  const stats = useQuery({
    queryKey: statsKey,
    queryFn: () => request<PlatformStats>("/platform/v1/stats"),
  });
  const canWrite = operator.data?.role === "owner" || operator.data?.role === "operator";
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<CreatedPlatformShop>();

  // Betreibersitzung abgelaufen (1 Stunde ohne Aktivität): zurück zum Anmelden.
  const expired = [operator.error, shops.error, stats.error].some(
    (e) => e instanceof ApiError && e.status === 401,
  );
  useEffect(() => {
    if (expired) queryClient.removeQueries({ queryKey: sessionKey });
  }, [expired, queryClient]);
  if (expired) return <Navigate to="/anmelden" replace />;

  const active = shops.data?.filter((s) => s.status === "active").length ?? 0;
  const perShop = new Map(stats.data?.perShop.map((p) => [p.id, p]));
  return (
    <div>
      <PlatformStatsSection stats={stats.data} error={stats.isError ? stats.error.message : undefined} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Shops</h1>
          {shops.data && (
            <p className="text-sm text-gray-500">
              {shops.data.length === 1 ? "1 Shop" : `${shops.data.length} Shops`} · {active} geöffnet
            </p>
          )}
        </div>
        {canWrite && !showForm && (
          <Button
            onClick={() => {
              setCreated(undefined);
              setShowForm(true);
            }}
          >
            Neuer Shop
          </Button>
        )}
      </div>
      {created && <CreatedNotice shop={created} onClose={() => setCreated(undefined)} />}
      {showForm && (
        <NewShopForm
          onCancel={() => setShowForm(false)}
          onCreated={(shop) => {
            setShowForm(false);
            setCreated(shop);
            void queryClient.invalidateQueries({ queryKey: shopsKey });
            void queryClient.invalidateQueries({ queryKey: statsKey });
          }}
        />
      )}
      {(shops.isPending || operator.isPending) && (
        <div className="flex justify-center py-16 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Shops werden geladen …</span>
        </div>
      )}
      {shops.isError && <Alert>{shops.error.message}</Alert>}
      {operator.isError && <Alert>{operator.error.message}</Alert>}
      {shops.data && operator.data && (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Shop
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  Inhaberin / Inhaber
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  Angelegt
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium lg:table-cell">
                  Heute
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  7 Tage
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Stand
                </th>
                {canWrite && (
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Aktion</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shops.data.map((s) => (
                <ShopRow key={s.id} shop={s} canWrite={canWrite} numbers={perShop.get(s.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ShopRow({
  shop,
  canWrite,
  numbers,
}: {
  shop: PlatformShop;
  canWrite: boolean;
  numbers: PlatformStats["perShop"][number] | undefined;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const suspended = shop.status === "suspended";
  const change = useMutation({
    mutationFn: () =>
      request<PlatformShop>(`/platform/v1/shops/${shop.id}/${suspended ? "reactivate" : "suspend"}`, {
        method: "POST",
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<PlatformShop[]>(shopsKey, (old) =>
        old?.map((s) => (s.id === updated.id ? updated : s)),
      );
      void queryClient.invalidateQueries({ queryKey: statsKey });
    },
  });
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{shop.name}</div>
        <a
          href={`${siblingOrigin("shop")}/${shop.handle}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brand-800 hover:underline"
        >
          /{shop.handle} ansehen
        </a>
        {change.isError && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {change.error.message}
          </p>
        )}
      </td>
      <td className="hidden px-4 py-3 text-gray-600 md:table-cell">{shop.ownerEmail ?? "–"}</td>
      <td className="hidden px-4 py-3 text-gray-600 sm:table-cell">
        {DATE.format(new Date(shop.createdAt))}
      </td>
      <td className="hidden px-4 py-3 text-right text-gray-600 tabular-nums lg:table-cell">
        {numbers === undefined ? "–" : formatEuro(numbers.revenueToday)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {numbers === undefined ? (
          "–"
        ) : (
          <>
            <div className="text-gray-900">{formatEuro(numbers.revenue7d)}</div>
            <div className="text-xs text-gray-500">{orderCount(numbers.orders7d)}</div>
          </>
        )}
      </td>
      <td className="px-4 py-3">
        {shop.status === "active" ? (
          <Badge tone="green">Geöffnet</Badge>
        ) : suspended ? (
          <Badge tone="amber">Gesperrt</Badge>
        ) : (
          <Badge tone="stone">{shop.status}</Badge>
        )}
      </td>
      {canWrite && (
        <td className="px-4 py-3 text-right">
          {(shop.status === "active" || suspended) && (
            <Button
              variant={suspended ? "secondary" : "danger"}
              busy={change.isPending}
              onClick={async () => {
                if (
                  suspended ||
                  (await confirm({
                    title: `„${shop.name}“ sperren?`,
                    message:
                      "Der Shop ist dann für Kunden nicht mehr erreichbar, und niemand vom Shop kann sich anmelden. Die Daten bleiben.",
                    confirmLabel: "Sperren",
                    tone: "danger",
                  }))
                )
                  change.mutate();
              }}
            >
              {suspended ? "Freischalten" : "Sperren"}
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

function NewShopForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (shop: CreatedPlatformShop) => void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const shownHandle = handleTouched ? handle : handleFromName(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      onCreated(
        await request<CreatedPlatformShop>("/platform/v1/shops", {
          method: "POST",
          body: { name: name.trim(), handle: shownHandle, ownerEmail: ownerEmail.trim() },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "Anlegen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  const general = error && error.errors.length === 0 ? error.message : undefined;
  const handleError =
    error?.field("/body/handle") !== undefined
      ? "Nur Kleinbuchstaben, Ziffern und Bindestriche, 3 bis 63 Zeichen."
      : error?.status === 409
        ? error.message
        : undefined;
  return (
    <Card title="Neuer Shop" className="mb-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {general && error?.status !== 409 && (
          <div className="sm:col-span-2">
            <Alert>{general}</Alert>
          </div>
        )}
        <Field label="Name des Shops" error={error?.field("/body/name")}>
          {(p) => (
            <Input
              {...p}
              required
              autoFocus
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Kurzname"
          hint={`Teil der Adresse: ${siblingOrigin("shop").replace(/^https?:\/\//, "")}/${shownHandle || "…"}`}
          error={handleError}
        >
          {(p) => (
            <Input
              {...p}
              required
              maxLength={63}
              value={shownHandle}
              onChange={(e) => {
                setHandleTouched(true);
                setHandle(e.target.value.toLowerCase());
              }}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="E-Mail der Inhaberin oder des Inhabers"
            hint="Bekommt eine Einladung mit Link, wählt damit ein Passwort und kommt ins Backoffice."
            error={error?.field("/body/ownerEmail")}
          >
            {(p) => (
              <Input
                {...p}
                type="email"
                required
                autoComplete="off"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" busy={busy}>
            Shop anlegen und einladen
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CreatedNotice({ shop, onClose }: { shop: CreatedPlatformShop; onClose: () => void }) {
  return (
    <div className="mb-6">
      <Alert tone={shop.invitationSent ? "success" : "info"}>
        <p className="font-medium">„{shop.name}“ ist angelegt und geöffnet.</p>
        {shop.invitationSent ? (
          <p className="mt-1">
            Die Einladung an {shop.ownerEmail} ist unterwegs
            {shop.invitationExpiresAt !== null &&
              ` (Link gilt bis ${DATE_TIME.format(new Date(shop.invitationExpiresAt))})`}
            . Auf dem Testsystem landet sie im{" "}
            <a href={siblingOrigin("mail")} target="_blank" rel="noreferrer" className="underline">
              Test-Postfach
            </a>
            .
          </p>
        ) : (
          <p className="mt-1">Die Einladung ging nicht hinaus. Bitte später noch einmal versuchen.</p>
        )}
        <p className="mt-2 flex gap-4">
          <a
            href={`${siblingOrigin("shop")}/${shop.handle}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
          >
            Shop ansehen
          </a>
          <button type="button" className="underline" onClick={onClose}>
            Ausblenden
          </button>
        </p>
      </Alert>
    </div>
  );
}

// --- Kennzahlen aller Shops ---

function orderCount(n: number): string {
  return n === 1 ? "1 Bestellung" : `${n} Bestellungen`;
}

/** Summe der Umsätze der letzten 7 Tage und Zahl der Bestellungen. */
export function weekTotals(days: PlatformStats["days"]): { revenue: number; orders: number } {
  return days.reduce((t, d) => ({ revenue: t.revenue + d.revenue, orders: t.orders + d.orders }), {
    revenue: 0,
    orders: 0,
  });
}

function PlatformStatsSection({
  stats,
  error,
}: {
  stats: PlatformStats | undefined;
  error: string | undefined;
}) {
  if (error !== undefined)
    return (
      <div className="mb-8">
        <Alert>Die Kennzahlen ließen sich gerade nicht laden: {error}</Alert>
      </div>
    );
  if (stats === undefined)
    return (
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-white ring-1 ring-gray-200" />
        ))}
      </div>
    );
  const today = stats.days.at(-1) ?? { orders: 0, revenue: 0 };
  const week = weekTotals(stats.days);
  return (
    <section className="mb-8" aria-labelledby="kennzahlen">
      <h2 id="kennzahlen" className="mb-3 text-sm font-medium text-gray-500">
        Alle Shops auf einen Blick
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Store}
          color="#7c3aed"
          label="Shops"
          value={String(stats.shops)}
          note={`${stats.activeShops} geöffnet${stats.suspendedShops > 0 ? ` · ${stats.suspendedShops} gesperrt` : ""}`}
        />
        <StatTile
          icon={Euro}
          color="#16a34a"
          label="Umsatz heute"
          value={formatEuro(today.revenue)}
          note={orderCount(today.orders)}
        />
        <StatTile
          icon={TrendingUp}
          color="#2563eb"
          label="Umsatz 7 Tage"
          value={formatEuro(week.revenue)}
          note={orderCount(week.orders)}
        />
        <StatTile
          icon={PackageCheck}
          color="#d97706"
          label="Zu versenden"
          value={String(stats.toShip)}
          note={`${stats.awaitingPayment} warten auf Zahlung`}
          noteIcon
        />
      </div>
      {stats.days.length > 0 && (
        <div className="mt-3 rounded-xl bg-white p-4 ring-1 ring-gray-200 sm:p-5">
          <p className="mb-3 text-sm text-gray-600">
            Umsatz je Tag, alle Shops zusammen (nur bezahlte Bestellungen)
          </p>
          <WeekChart days={stats.days} />
        </div>
      )}
      {stats.truncated && (
        <p className="mt-2 text-xs text-gray-500">
          Es gibt sehr viele Shops; eingerechnet sind die ältesten.
        </p>
      )}
    </section>
  );
}

function StatTile({
  icon: I,
  color,
  label,
  value,
  note,
  noteIcon = false,
}: {
  icon: typeof Euro;
  color: string;
  label: string;
  value: string;
  note: string;
  noteIcon?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-gray-200/80 sm:p-5">
      <p className="flex items-center gap-2 text-sm text-gray-600">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-md"
          style={{ background: `${color}1a`, color }}
        >
          <I className="size-4" aria-hidden="true" />
        </span>
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.01em] text-gray-900 tabular-nums">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
        {noteIcon && <Clock className="size-3" aria-hidden="true" />}
        {note}
      </p>
    </div>
  );
}

/** Ein Balken je Tag; Betrag steht beim Zeigen darüber und für Screenreader im Label. */
function WeekChart({ days }: { days: PlatformStats["days"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.revenue), 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-2 border-b border-gray-200 sm:gap-3" role="list">
        {days.map((d, i) => {
          const label = dayLabel(d.date);
          const height = d.revenue === 0 ? 0 : Math.max(4, Math.round((d.revenue / max) * 100));
          return (
            <div
              key={d.date}
              role="listitem"
              aria-label={`${label.weekday} ${label.day}: ${formatEuro(d.revenue)}, ${orderCount(d.orders)}`}
              className="relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow">
                  {formatEuro(d.revenue)} · {orderCount(d.orders)}
                </div>
              )}
              <div
                className={
                  "w-full max-w-10 rounded-t " + (i === days.length - 1 ? "bg-brand-700" : "bg-brand-600/70")
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
            <div key={d.date} className="flex-1 text-center text-xs text-gray-500">
              <div className={i === days.length - 1 ? "font-medium text-gray-800" : undefined}>
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
