// Rahmen für alles im Shop (M3, Redesign 14.11.2026): Seitenleiste links mit Shop, Menü in Gruppen,
// Assistent und Konto (am Handy als ausklappbare Leiste). Der Shop steht im Pfad (/<handle>/produkte),
// damit Links und Neuladen den gewählten Shop behalten.
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Building2,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  PenTool,
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
  return <Navigate to="/$shop/dashboard" params={{ shop: first.handle }} replace />;
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
  { items: [{ to: "/$shop/dashboard", label: "Dashboard", icon: LayoutDashboard, color: "#5b6472" }] },
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
    title: "Onlineshop",
    items: [
      { to: "/$shop/editor", label: "Editor", icon: PenTool, color: "#e0567a" },
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

/** Seitenleiste links, Kopfzeile oben, Inhalt und die Chat-Blase des Assistenten unten rechts. */
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
  // Der Editor braucht die ganze Breite (eigene zweite Leiste und große Vorschau).
  const fullBleed = location.pathname.endsWith("/editor");
  // Dashboard: ganz sanfter blauer Verlauf im Hintergrund, damit es nicht so weiß wirkt.
  const dashboard = location.pathname.endsWith("/dashboard");
  const chatOpen = assistant.open && !onAssistantPage;
  const groups = shop.role === "owner" ? [...GROUPS, { title: "Einstellungen", items: [TEAM] }] : GROUPS;
  const current = groups
    .flatMap((g) => g.items)
    .find((m) => location.pathname.startsWith(m.to.replace("$shop", shop.handle)));

  return (
    <div className="min-h-dvh">
      {/* Computer: feste Leiste links */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-gray-200 bg-gray-50 lg:block">
        <Sidebar shops={shops} groups={groups} />
      </aside>

      {/* Handy und Tablet: Menü klappt als Leiste auf */}
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
            <Sidebar shops={shops} groups={groups} />
          </div>
        </div>
      )}

      <div className={"min-h-dvh lg:pl-64 " + (dashboard ? "dashboard-bg" : "")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200/80 bg-white/75 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            className="-ml-1 inline-flex size-9 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-600 lg:hidden"
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
          <p className="flex min-w-0 items-center gap-2 text-gray-500">
            <SlopifyMark className="size-5 shrink-0 lg:hidden" />
            <span className="truncate font-medium text-gray-900 lg:font-normal lg:text-gray-500">
              {shop.name}
            </span>
            {current && (
              <>
                <span aria-hidden="true" className="hidden text-gray-300 sm:inline">
                  /
                </span>
                <span className="hidden truncate font-medium text-gray-900 sm:inline">{current.label}</span>
              </>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {operator && (
              <Link
                to="/plattform"
                className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 md:inline-flex"
              >
                <Building2 className="size-4" aria-hidden="true" />
                Plattform
              </Link>
            )}
            <a
              href={storefrontUrl(shop.handle, window.location)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-xs ring-1 ring-gray-200 transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <ExternalLink className="size-4 text-gray-500" aria-hidden="true" />
              <span className="hidden sm:inline">Shop ansehen</span>
              <span className="sr-only sm:hidden">Shop ansehen</span>
            </a>
            <UserMenu email={email} operator={operator} />
          </div>
        </header>
        <main
          className={
            fullBleed ? "relative isolate" : "relative isolate mx-auto max-w-6xl px-4 py-6 sm:px-8 lg:py-8"
          }
        >
          <Outlet />
        </main>
      </div>

      {chatOpen && (
        <section
          aria-label="Assistent"
          className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-gray-50 sm:inset-auto sm:right-5 sm:bottom-24 sm:h-[min(42rem,calc(100dvh-8rem))] sm:w-[26rem] sm:rounded-2xl sm:shadow-pop sm:ring-1 sm:ring-gray-200"
        >
          <AssistantChat variant="panel" />
        </section>
      )}
      {!onAssistantPage && (
        <button
          type="button"
          onClick={() => assistant.setOpen(!assistant.open)}
          aria-pressed={chatOpen}
          aria-label={chatOpen ? "Chat schließen" : "Assistent öffnen"}
          title="Assistent"
          className={
            "fixed right-5 bottom-5 z-40 size-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-brand-600 text-white shadow-pop transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 " +
            (chatOpen ? "hidden sm:flex" : "flex")
          }
        >
          {chatOpen ? (
            <X className="size-6" aria-hidden="true" />
          ) : (
            <MessageCircle className="size-6" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}

/** Konto oben rechts: E-Mail und Abmelden. */
function UserMenu({ email, operator }: { email: string; operator: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Konto"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-sm font-semibold text-gray-700"
        >
          {email.slice(0, 1).toUpperCase()}
        </span>
        <ChevronDown className="size-4 text-gray-500" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-lg bg-white p-1.5 shadow-pop ring-1 ring-gray-200">
          <p className="px-2.5 pt-1.5 pb-2 text-xs text-gray-500">
            Angemeldet als
            <span className="block truncate text-sm font-medium text-gray-900">{email}</span>
          </p>
          {operator && (
            <Link
              to="/plattform"
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-100 md:hidden"
            >
              <Building2 className="size-4" aria-hidden="true" />
              Plattform-Verwaltung
            </Link>
          )}
          <div className="border-t border-gray-100 pt-1.5">
            <SignOutButton className="w-full justify-start" />
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({
  shops,
  groups,
}: {
  shops: readonly ShopOfUser[];
  groups: readonly { readonly title?: string; readonly items: readonly MenuItem[] }[];
}) {
  const shop = useShop();
  const navigate = useNavigate();
  const item =
    "group flex items-center gap-3 rounded-md px-2.5 py-2 text-[0.95rem] text-gray-700 transition-colors hover:bg-gray-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600";
  const active = "bg-white font-medium text-gray-900 shadow-xs ring-1 ring-gray-200 hover:bg-white";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-gray-200 px-3">
        <div className="relative flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-150">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-brand-600 text-sm font-bold text-white"
          >
            {shop.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.95rem] leading-tight font-semibold text-gray-900">
              {shop.name}
            </span>
            <span className="block truncate text-xs text-gray-500">{roleName(shop.role)}</span>
          </span>
          {shops.length > 1 && (
            <>
              <ChevronsUpDown className="size-4 shrink-0 text-gray-400" aria-hidden="true" />
              <select
                aria-label="Shop wechseln"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={shop.handle}
                onChange={(e) => void navigate({ to: "/$shop/dashboard", params: { shop: e.target.value } })}
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

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Hauptmenü">
        {groups.map((g, gi) => (
          <div key={g.title ?? gi} className={gi === 0 ? "" : "mt-5"}>
            {g.title && (
              <p className="px-2.5 pb-1.5 text-[0.7rem] font-semibold tracking-[0.07em] text-gray-400 uppercase">
                {g.title}
              </p>
            )}
            <ul className="space-y-0.5">
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
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-gray-200 px-5 py-3 text-xs text-gray-400">
        <SlopifyMark className="size-4" />
        slopify
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
      className="flex size-6 shrink-0 items-center justify-center rounded-md"
      style={{ background: color }}
    >
      <I className="size-4 text-white" aria-hidden="true" />
    </span>
  );
}
