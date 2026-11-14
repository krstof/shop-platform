// Rahmen für alles im Shop (M3): Kopfzeile mit Shop-Auswahl und Abmelden. Der Shop steht im Pfad
// (/<handle>/produkte), damit Links und Neuladen den gewählten Shop behalten.
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShopContext, useShop } from "../lib/shop.js";
import { Button, Spinner } from "../components/ui.js";
import { ApiError, request, type ShopOfUser } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { SlopifyMark } from "../components/logo.js";
import { AssistantChat, AssistantProvider, useAssistant } from "./assistant.js";

// Der Shop-Kontext liegt in lib/shop.ts (sonst Kreis mit pages/assistant.tsx); hier weitergereicht.
export { useShop };

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-stone-500" role="status">
      <Spinner className="size-6" />
      <span className="sr-only">Wird geladen …</span>
    </div>
  );
}

/** Startseite: zum Anmelden oder in den ersten Shop. */
export function HomeRedirect() {
  const session = useSession();
  if (session.isPending) return <FullPageSpinner />;
  if (!session.data) return <Navigate to="/anmelden" replace />;
  const first = session.data.shops[0];
  // Betreiberkonto ohne eigenen Shop: gleich in die Plattform-Verwaltung (M8).
  if (first === undefined && session.data.platformOperator) return <Navigate to="/plattform" replace />;
  if (first === undefined) return <NoShop />;
  return <Navigate to="/$shop/uebersicht" params={{ shop: first.handle }} replace />;
}

function NoShop() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Noch kein Shop</h1>
      <p className="mt-2 text-stone-600">
        Dein Konto gehört noch zu keinem aktiven Shop. Bitte die Inhaberin oder den Betreiber um eine
        Einladung.
      </p>
      <SignOutButton className="mt-6" />
    </main>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
      <Button
        variant="ghost"
        className={className}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await request("/auth/v1/sign-out", { method: "POST" });
          } catch (e) {
            // Nur wer schon abgemeldet ist (401), darf trotzdem weiter; sonst bleibt die Sitzung bestehen.
            if (!(e instanceof ApiError && e.status === 401)) {
              setError("Abmelden hat nicht geklappt. Bitte noch einmal versuchen.");
              setBusy(false);
              return;
            }
          }
          queryClient.clear();
          await navigate({ to: "/anmelden" });
        }}
      >
        Abmelden
      </Button>
    </span>
  );
}

/** Menüpunkte des Shops. Reihenfolge = Reihenfolge im Menü. */
const MENU = [
  { to: "/$shop/uebersicht", label: "Übersicht" },
  { to: "/$shop/produkte", label: "Produkte" },
  { to: "/$shop/kategorien", label: "Kategorien" },
  { to: "/$shop/bestellungen", label: "Bestellungen" },
  { to: "/$shop/aussehen", label: "Aussehen" },
  { to: "/$shop/versand", label: "Versand" },
  { to: "/$shop/gutscheine", label: "Gutscheine" },
] as const;

/** Nur Inhaber:innen verwalten das Team. */
const TEAM = { to: "/$shop/team", label: "Team" } as const;

export function ShopLayout() {
  const { shop: handle } = useParams({ strict: false });
  const session = useSession();
  if (session.isPending) return <FullPageSpinner />;
  if (!session.data) return <Navigate to="/anmelden" replace />;
  const shops = session.data.shops;
  const shop = shops.find((s) => s.handle === handle);
  if (shop === undefined) return <Navigate to="/" replace />;
  const operator = session.data.platformOperator;

  return (
    <ShopContext.Provider value={shop}>
      <AssistantProvider>
        <ShopFrame shops={shops} email={session.data.user.email} operator={operator} />
      </AssistantProvider>
    </ShopContext.Provider>
  );
}

/** Kopfzeile, Inhalt und Seitenleiste des Assistenten. */
function ShopFrame({
  shops,
  email,
  operator,
}: {
  shops: readonly ShopOfUser[];
  email: string;
  operator: boolean;
}) {
  const shop = useShop();
  const navigate = useNavigate();
  const location = useLocation();
  const assistant = useAssistant();
  const [menuOpen, setMenuOpen] = useState(false);
  // Nach jedem Seitenwechsel ist das Handy-Menü wieder zu.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const onAssistantPage = location.pathname.endsWith("/assistent");
  const menu = shop.role === "owner" ? [...MENU, TEAM] : MENU;
  const panelOpen = assistant.open && !onAssistantPage;
  const toggleAssistant = () => {
    setMenuOpen(false);
    assistant.setOpen(!assistant.open);
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            to="/$shop/uebersicht"
            params={{ shop: shop.handle }}
            className="flex min-w-0 shrink items-center gap-2 font-semibold text-emerald-800 xl:shrink-0"
            title="Slopify"
          >
            <SlopifyMark className="size-6 shrink-0" />
            <span className="truncate">{shop.name}</span>
          </Link>
          {shops.length > 1 && (
            <label className="hidden text-sm text-stone-600 sm:block">
              <span className="sr-only">Shop wechseln</span>
              <ShopSelect
                shops={shops}
                value={shop.handle}
                onChange={(h) => void navigate({ to: "/$shop/uebersicht", params: { shop: h } })}
              />
            </label>
          )}
          <nav className="ml-2 hidden gap-1 text-sm xl:flex" aria-label="Hauptmenü">
            {menu.map((m) => (
              <Link
                key={m.to}
                to={m.to}
                params={{ shop: shop.handle }}
                className="rounded-md px-3 py-1.5 whitespace-nowrap text-stone-600 hover:bg-stone-100"
                activeProps={{ className: "bg-stone-100 font-medium text-stone-900" }}
              >
                {m.label}
              </Link>
            ))}
            <AssistantToggle open={panelOpen} hidden={onAssistantPage} onClick={toggleAssistant} />
          </nav>
          <div className="ml-auto hidden items-center gap-2 xl:flex">
            {operator && (
              <Link
                to="/plattform"
                className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Plattform
              </Link>
            )}
            <span className="hidden text-sm text-stone-500 2xl:inline">{email}</span>
            <SignOutButton />
          </div>
          <div className="ml-auto xl:hidden">
            <AssistantToggle open={panelOpen} hidden={onAssistantPage} onClick={toggleAssistant} />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-stone-100 xl:hidden"
            aria-expanded={menuOpen}
            aria-controls="handy-menue"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MenuIcon open={menuOpen} />
            Menü
          </button>
        </div>
        {menuOpen && (
          <div id="handy-menue" className="border-t border-stone-200 bg-white xl:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col px-4 py-2 sm:px-6" aria-label="Hauptmenü">
              {menu.map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  params={{ shop: shop.handle }}
                  className="rounded-md px-3 py-3 text-base text-stone-700 hover:bg-stone-100"
                  activeProps={{ className: "bg-stone-100 font-medium text-stone-900" }}
                >
                  {m.label}
                </Link>
              ))}
              {operator && (
                <Link
                  to="/plattform"
                  className="rounded-md px-3 py-3 text-base text-stone-700 hover:bg-stone-100"
                >
                  Plattform-Verwaltung
                </Link>
              )}
              {shops.length > 1 && (
                <label className="flex items-center justify-between gap-3 px-3 py-3 text-base text-stone-700 sm:hidden">
                  Shop wechseln
                  <ShopSelect
                    shops={shops}
                    value={shop.handle}
                    onChange={(h) => void navigate({ to: "/$shop/uebersicht", params: { shop: h } })}
                  />
                </label>
              )}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-stone-100 px-3 pt-3 pb-1">
                <span className="truncate text-sm text-stone-500">{email}</span>
                <SignOutButton />
              </div>
            </nav>
          </div>
        )}
      </header>
      <div className={panelOpen ? "lg:mr-[26rem]" : undefined}>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
      {panelOpen && (
        <aside
          aria-label="Assistent"
          className="fixed inset-x-0 top-14 bottom-0 z-10 bg-stone-50 lg:left-auto lg:w-[26rem] lg:border-l lg:border-stone-200 lg:shadow-xl"
        >
          <AssistantChat variant="panel" />
        </aside>
      )}
    </div>
  );
}

/** Knopf „Assistent“ in der Kopfzeile: öffnet und schließt die Seitenleiste. */
function AssistantToggle({ open, hidden, onClick }: { open: boolean; hidden: boolean; onClick: () => void }) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      className={
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap " +
        (open ? "bg-violet-100 font-medium text-violet-900" : "text-violet-700 hover:bg-violet-50")
      }
    >
      <SlopifyMark className="size-4" />
      Assistent
    </button>
  );
}

function ShopSelect({
  shops,
  value,
  onChange,
}: {
  shops: readonly ShopOfUser[];
  value: string;
  onChange: (handle: string) => void;
}) {
  return (
    <select
      className="rounded-md border-0 bg-stone-100 py-1 pr-7 pl-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {shops.map((s) => (
        <option key={s.id} value={s.handle}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
    </svg>
  );
}
