// Plattform-Verwaltung (M8): Shops auflisten, anlegen (lädt die Inhaberin ein), sperren und wieder
// freischalten. Nur für Betreiberkonten mit bestätigtem zweitem Faktor; wer noch keinen hat, richtet
// ihn hier ein. Nutzt nur die Platform-API und die Auth-API, nie eine Shop-Id.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Field, Input, Spinner } from "../components/ui.js";
import {
  ApiError,
  listAllPlatform,
  request,
  type CreatedPlatformShop,
  type CurrentSession,
  type OperatorRole,
  type PlatformShop,
  type TwoFactorSetup,
} from "../lib/api.js";
import { handleFromName } from "../lib/handle.js";
import { groupSecret, qrPath } from "../lib/qr.js";
import { sessionKey, useSession } from "../lib/session.js";
import { FullPageSpinner, SignOutButton } from "./layout.js";

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
  if (s.secondFactor !== "verified")
    return (
      <PlatformFrame email={s.user.email}>
        <TwoFactorSetupCard />
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
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/plattform" className="flex items-center gap-2 font-semibold text-stone-900">
            <span className="rounded-md bg-stone-900 px-2 py-0.5 text-xs font-medium tracking-wide text-white">
              Betrieb
            </span>
            Plattform-Verwaltung
          </Link>
          {hasShops && firstShop !== undefined && (
            <Link
              to="/$shop/produkte"
              params={{ shop: firstShop }}
              className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
            >
              Zu meinem Shop
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-stone-500 sm:inline">{email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

// --- Zwei-Faktor einrichten ---

function TwoFactorSetupCard() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      setSetup(
        await request<TwoFactorSetup>("/auth/v1/two-factor/setup", { method: "POST", body: { password } }),
      );
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const s = await request<CurrentSession>("/auth/v1/two-factor/enable", {
        method: "POST",
        body: { code },
      });
      queryClient.setQueryData(sessionKey, s);
    } catch (err) {
      // 401: zu viele falsche Codes, die Sitzung ist beendet. Dann neu anmelden.
      if (err instanceof ApiError && err.status === 401)
        await queryClient.invalidateQueries({ queryKey: sessionKey });
      else
        setError(
          err instanceof ApiError ? (err.field("/body/code") ?? err.message) : "Das hat nicht geklappt.",
        );
    } finally {
      setBusy(false);
    }
  }

  if (setup === undefined)
    return (
      <Card className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">Zwei-Faktor einrichten</h1>
        <p className="mt-2 text-sm text-stone-600">
          Die Plattform-Verwaltung öffnet sich nur mit einem zweiten Schritt beim Anmelden: einem Code aus
          einer Authenticator-App auf dem Handy (etwa Google Authenticator, Microsoft Authenticator oder
          2FAS). Das ist einmalig und dauert eine Minute.
        </p>
        <form onSubmit={start} className="mt-6 space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Zur Sicherheit: dein Passwort">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            Weiter
          </Button>
        </form>
      </Card>
    );

  const qr = qrPath(setup.otpauthUri);
  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Zwei-Faktor einrichten</h1>
      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold">1. Mit der App scannen</h2>
          <svg
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            className="mt-3 size-52 rounded-lg ring-1 ring-stone-200"
            role="img"
            aria-label="QR-Code für die Authenticator-App"
            shapeRendering="crispEdges"
          >
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
          <p className="mt-3 text-xs text-stone-500">
            Scannen klappt nicht? Diesen Schlüssel in der App eintippen:
          </p>
          <p className="mt-1 font-mono text-sm break-all select-all">{groupSecret(setup.secret)}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">2. Ersatzcodes aufheben</h2>
          <p className="mt-1 text-xs text-stone-500">
            Falls das Handy weg ist: Jeder Code gilt einmal statt des App-Codes. Sie werden nur jetzt gezeigt.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-stone-50 p-3 font-mono text-sm select-all">
            {setup.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <form onSubmit={enable} className="mt-6 space-y-4" noValidate>
            <h2 className="text-sm font-semibold">3. Code aus der App eingeben</h2>
            {error && <Alert>{error}</Alert>}
            <Field label="6-stelliger Code">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.trim())}
                />
              )}
            </Field>
            <Button type="submit" busy={busy} className="w-full">
              Einschalten
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}

// --- Shops ---

const shopsKey = ["platform", "shops"] as const;

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
  const canWrite = operator.data?.role === "owner" || operator.data?.role === "operator";
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<CreatedPlatformShop>();

  // Betreibersitzung abgelaufen (1 Stunde ohne Aktivität): zurück zum Anmelden.
  const expired = [operator.error, shops.error].some((e) => e instanceof ApiError && e.status === 401);
  useEffect(() => {
    if (expired) queryClient.removeQueries({ queryKey: sessionKey });
  }, [expired, queryClient]);
  if (expired) return <Navigate to="/anmelden" replace />;

  const active = shops.data?.filter((s) => s.status === "active").length ?? 0;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shops</h1>
          {shops.data && (
            <p className="text-sm text-stone-500">
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
          }}
        />
      )}
      {(shops.isPending || operator.isPending) && (
        <div className="flex justify-center py-16 text-stone-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Shops werden geladen …</span>
        </div>
      )}
      {shops.isError && <Alert>{shops.error.message}</Alert>}
      {operator.isError && <Alert>{operator.error.message}</Alert>}
      {shops.data && operator.data && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
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
            <tbody className="divide-y divide-stone-100">
              {shops.data.map((s) => (
                <ShopRow key={s.id} shop={s} canWrite={canWrite} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ShopRow({ shop, canWrite }: { shop: PlatformShop; canWrite: boolean }) {
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
    },
  });
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-stone-900">{shop.name}</div>
        <a
          href={`${siblingOrigin("shop")}/${shop.handle}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-emerald-800 hover:underline"
        >
          /{shop.handle} ansehen
        </a>
        {change.isError && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {change.error.message}
          </p>
        )}
      </td>
      <td className="hidden px-4 py-3 text-stone-600 md:table-cell">{shop.ownerEmail ?? "–"}</td>
      <td className="hidden px-4 py-3 text-stone-600 sm:table-cell">
        {DATE.format(new Date(shop.createdAt))}
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
              onClick={() => {
                if (
                  suspended ||
                  window.confirm(
                    `„${shop.name}“ sperren? Der Shop ist dann für Kunden nicht mehr erreichbar, und niemand vom Shop kann sich anmelden. Die Daten bleiben.`,
                  )
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
