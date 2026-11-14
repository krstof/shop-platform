// Rahmen für alles im Shop (M3, Redesign 14.11.2026): Seitenleiste links mit Shop, Menü in Gruppen,
// Assistent und Konto (am Handy als ausklappbare Leiste). Der Shop steht im Pfad (/<handle>/produkte),
// damit Links und Neuladen den gewählten Shop behalten.
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import {
  Building2,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Palette,
  ShoppingBag,
  Tags,
  TicketPercent,
  Truck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { storefrontUrl } from "../lib/design.js";
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
    <div className="flex min-h-dvh items-center justify-center text-gray-500" role="status">
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
      <p className="mt-2 text-gray-600">
        Dein Konto gehört noch zu keinem aktiven Shop. Bitte die Inhaberin oder den Betreiber um eine
        Einladung.
      </p>
      <SignOutButton className="mt-6" />
    </main>
  );
}

export function SignOutButton({ className, compact = false }: { className?: string; compact?: boolean }) {
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
        className={compact ? `min-h-8 px-2 ${className ?? ""}` : className}
        busy={busy}
        aria-label={compact ? "Abmelden" : undefined}
        title={compact ? "Abmelden" : undefined}
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
        {compact ? !busy && <LogOut className="size-4" aria-hidden="true" /> : "Abmelden"}
      </Button>
    </span>
  );
}

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
type MenuItem = { readonly to: string; readonly label: string; readonly icon: Icon; readonly color: string };

/** Menü in Gruppen (Reihenfolge = Reihenfolge in der Seitenleiste). Farbe = Feld hinter dem Symbol. */
const GROUPS: readonly { readonly title?: string; readonly items: readonly MenuItem[] }[] = [
  { items: [{ to: "/$shop/uebersicht", label: "Übersicht", icon: LayoutDashboard, color: "#5b6472" }] },
  {
    title: "Verkauf",
    items: [
      { to: "/$shop/bestellungen", label: "Bestellungen", icon: ShoppingBag, color: "#3354e0" },
      { to: "/$shop/kunden", label: "Kunden", icon: Users, color: "#0d8f7f" },
      { to: "/$shop/gutscheine", label: "Gutscheine", icon: TicketPercent, color: "#d6337a" },
    ],
  },
  {
    title: "Katalog",
    items: [
      { to: "/$shop/produkte", label: "Produkte", icon: Package, color: "#7c3aed" },
      { to: "/$shop/kategorien", label: "Kategorien", icon: Tags, color: "#d9822b" },
    ],
  },
  {
    title: "Online-Shop",
    items: [
      { to: "/$shop/aussehen", label: "Aussehen", icon: Palette, color: "#e0567a" },
      { to: "/$shop/versand", label: "Versand", icon: Truck, color: "#1d8fc4" },
    ],
  },
];

/** Nur Inhaber:innen verwalten das Team. */
const TEAM: MenuItem = { to: "/$shop/team", label: "Team", icon: UserCog, color: "#5b6472" };

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

/** Seitenleiste, Inhalt und Seitenleiste des Assistenten. */
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
  const location = useLocation();
  const assistant = useAssistant();
  const [menuOpen, setMenuOpen] = useState(false);
  // Nach jedem Seitenwechsel ist das Handy-Menü wieder zu.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const onAssistantPage = location.pathname.endsWith("/assistent");
  const panelOpen = assistant.open && !onAssistantPage;
  const toggleAssistant = () => {
    setMenuOpen(false);
    assistant.setOpen(!assistant.open);
  };

  const sidebar = (
    <Sidebar
      shops={shops}
      email={email}
      operator={operator}
      assistantOpen={panelOpen}
      assistantHidden={onAssistantPage}
      onAssistant={toggleAssistant}
    />
  );

  return (
    <div className="min-h-dvh">
      {/* Computer: feste Leiste links */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-gray-200 bg-gray-50 lg:block">
        {sidebar}
      </aside>

      {/* Handy und Tablet: schmale Kopfzeile, Menü klappt als Leiste auf */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          className="-ml-1 inline-flex size-9 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-600"
          aria-expanded={menuOpen}
          aria-controls="handy-menue"
          aria-label={menuOpen ? "Menü schließen" : "Menü öffnen"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? (
            <X className="size-5" aria-hidden="true" />
          ) : (
            <Menu className="size-5" aria-hidden="true" />
          )}
        </button>
        <Link
          to="/$shop/uebersicht"
          params={{ shop: shop.handle }}
          className="flex min-w-0 items-center gap-2 font-semibold text-gray-900"
        >
          <SlopifyMark className="size-6 shrink-0" />
          <span className="truncate">{shop.name}</span>
        </Link>
        <div className="ml-auto">
          <AssistantToggle open={panelOpen} hidden={onAssistantPage} onClick={toggleAssistant} />
        </div>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 top-14 z-30 lg:hidden">
          <button
            type="button"
            aria-label="Menü schließen"
            className="absolute inset-0 bg-gray-900/30"
            onClick={() => setMenuOpen(false)}
          />
          <div
            id="handy-menue"
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-gray-200 bg-gray-50 shadow-pop"
          >
            {sidebar}
          </div>
        </div>
      )}

      <div className={"lg:pl-60 " + (panelOpen ? "lg:pr-[26rem]" : "")}>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
      {panelOpen && (
        <aside
          aria-label="Assistent"
          className="fixed inset-x-0 top-14 bottom-0 z-10 bg-gray-50 lg:top-0 lg:left-auto lg:w-[26rem] lg:border-l lg:border-gray-200 lg:shadow-pop"
        >
          <AssistantChat variant="panel" />
        </aside>
      )}
    </div>
  );
}

function Sidebar({
  shops,
  email,
  operator,
  assistantOpen,
  assistantHidden,
  onAssistant,
}: {
  shops: readonly ShopOfUser[];
  email: string;
  operator: boolean;
  assistantOpen: boolean;
  assistantHidden: boolean;
  onAssistant: () => void;
}) {
  const shop = useShop();
  const navigate = useNavigate();
  const groups = shop.role === "owner" ? [...GROUPS, { title: "Einstellungen", items: [TEAM] }] : GROUPS;
  const item =
    "group flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[14px] text-gray-700 transition-colors hover:bg-gray-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600";
  const active = "bg-white font-medium text-gray-900 shadow-xs ring-1 ring-gray-200 hover:bg-white";

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3 pb-2">
        <div className="relative flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-gray-150">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-brand-600 text-sm font-bold text-white"
          >
            {shop.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-gray-900">{shop.name}</span>
            <span className="block truncate text-xs text-gray-500">{roleName(shop.role)}</span>
          </span>
          {shops.length > 1 && (
            <>
              <ChevronsUpDown className="size-4 shrink-0 text-gray-400" aria-hidden="true" />
              <select
                aria-label="Shop wechseln"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={shop.handle}
                onChange={(e) => void navigate({ to: "/$shop/uebersicht", params: { shop: e.target.value } })}
              >
                {shops.map((s) => (
                  <option key={s.id} value={s.handle}>
                    {s.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Hauptmenü">
        {groups.map((g, gi) => (
          <div key={g.title ?? gi} className={gi === 0 ? "" : "mt-4"}>
            {g.title && (
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-[0.07em] text-gray-400 uppercase">
                {g.title}
              </p>
            )}
            <ul className="space-y-px">
              {g.items.map((m) => (
                <li key={m.to}>
                  <Link
                    to={m.to}
                    params={{ shop: shop.handle }}
                    className={item}
                    activeProps={{ className: active }}
                  >
                    <MenuIcon icon={m.icon} color={m.color} />
                    {m.label}
                  </Link>
                </li>
              ))}
              {gi === 0 && !assistantHidden && (
                <li>
                  <button
                    type="button"
                    onClick={onAssistant}
                    aria-pressed={assistantOpen}
                    className={item + " w-full " + (assistantOpen ? active : "")}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-violet-100"
                    >
                      <SlopifyMark className="size-3.5" />
                    </span>
                    <span className="text-violet-800">Assistent</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-200 px-3 py-3">
        <a
          href={storefrontUrl(shop.handle, window.location)}
          target="_blank"
          rel="noreferrer"
          className={item}
        >
          <ExternalLink className="size-4 text-gray-500" aria-hidden="true" />
          Shop ansehen
        </a>
        {operator && (
          <Link to="/plattform" className={item}>
            <Building2 className="size-4 text-gray-500" aria-hidden="true" />
            Plattform-Verwaltung
          </Link>
        )}
        <div className="mt-2 flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700"
          >
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-gray-600" title={email}>
            {email}
          </span>
          <SignOutButton compact />
        </div>
      </div>
    </div>
  );
}

function roleName(role: string): string {
  return role === "owner" ? "Inhaber:in" : role === "staff" ? "Mitarbeiter:in" : "Eigene Rolle";
}

/** Symbol im farbigen Feld (wie die Farbmarken in airfocus). */
function MenuIcon({ icon: I, color }: { icon: Icon; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-[5px]"
      style={{ background: color }}
    >
      <I className="size-3.5 text-white" aria-hidden="true" />
    </span>
  );
}

/** Knopf „Assistent“ in der Handy-Kopfzeile: öffnet und schließt die Seitenleiste. */
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
