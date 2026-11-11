// Rahmen für alles im Shop (M3): Kopfzeile mit Shop-Auswahl und Abmelden. Der Shop steht im Pfad
// (/<handle>/produkte), damit Links und Neuladen den gewählten Shop behalten.
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { createContext, useContext, useState } from "react";
import { Button, Spinner } from "../components/ui.js";
import { ApiError, request, type ShopOfUser } from "../lib/api.js";
import { useSession } from "../lib/session.js";

const ShopContext = createContext<ShopOfUser | null>(null);

/** Der gewählte Shop. Nur innerhalb von ShopLayout verwenden. */
export function useShop(): ShopOfUser {
  const shop = useContext(ShopContext);
  if (shop === null) throw new Error("useShop außerhalb eines Shops");
  return shop;
}

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
  return <Navigate to="/$shop/produkte" params={{ shop: first.handle }} replace />;
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

export function ShopLayout() {
  const { shop: handle } = useParams({ strict: false });
  const navigate = useNavigate();
  const session = useSession();
  if (session.isPending) return <FullPageSpinner />;
  if (!session.data) return <Navigate to="/anmelden" replace />;
  const shops = session.data.shops;
  const shop = shops.find((s) => s.handle === handle);
  if (shop === undefined) return <Navigate to="/" replace />;

  return (
    <ShopContext.Provider value={shop}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Link
              to="/$shop/produkte"
              params={{ shop: shop.handle }}
              className="font-semibold text-emerald-800"
            >
              {shop.name}
            </Link>
            {shops.length > 1 && (
              <label className="text-sm text-stone-600">
                <span className="sr-only">Shop wechseln</span>
                <select
                  className="rounded-md border-0 bg-stone-100 py-1 pr-7 pl-2 text-sm"
                  value={shop.handle}
                  onChange={(e) => void navigate({ to: "/$shop/produkte", params: { shop: e.target.value } })}
                >
                  {shops.map((s) => (
                    <option key={s.id} value={s.handle}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <nav className="ml-2 flex min-w-0 gap-1 overflow-x-auto text-sm" aria-label="Hauptmenü">
              <Link
                to="/$shop/produkte"
                params={{ shop: shop.handle }}
                className="rounded-md px-3 py-1.5 text-stone-600 hover:bg-stone-100"
                activeProps={{ className: "bg-stone-100 font-medium text-stone-900" }}
              >
                Produkte
              </Link>
              <Link
                to="/$shop/kategorien"
                params={{ shop: shop.handle }}
                className="rounded-md px-3 py-1.5 text-stone-600 hover:bg-stone-100"
                activeProps={{ className: "bg-stone-100 font-medium text-stone-900" }}
              >
                Kategorien
              </Link>
              <Link
                to="/$shop/bestellungen"
                params={{ shop: shop.handle }}
                className="rounded-md px-3 py-1.5 text-stone-600 hover:bg-stone-100"
                activeProps={{ className: "bg-stone-100 font-medium text-stone-900" }}
              >
                Bestellungen
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {session.data.platformOperator && (
                <Link
                  to="/plattform"
                  className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
                >
                  Plattform
                </Link>
              )}
              <span className="hidden text-sm text-stone-500 sm:inline">{session.data.user.email}</span>
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </ShopContext.Provider>
  );
}
