// Shop-Editor Teil 1 (13.11.2026): Menüpunkt „Aussehen“. Hauptfarbe, Schrift und Logo wählen, die
// Vorschau rechts zeigt jede Änderung sofort. Im Shop sichtbar wird erst „Veröffentlichen“.
// Die Vorschau ist ein Nachbau des Shop-Kopfs und einiger Produktkarten mit echten Daten.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import { Alert, Badge, Button, Card, Input, Spinner } from "../components/ui.js";
import {
  ApiError,
  fileToBase64,
  listAll,
  request,
  type DesignImage,
  type DesignState,
  type Product,
} from "../lib/api.js";
import {
  contrastWithWhite,
  darker,
  fontOf,
  FONTS,
  normalizeHex,
  PRESETS,
  readableWithWhite,
  storefrontUrl,
  type Font,
} from "../lib/design.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";
import { productsKey, useCategories } from "./products.js";

interface Form {
  accentColor: string;
  font: Font;
  logo: DesignImage | null;
}

const designKey = (shopId: string) => ["design", shopId] as const;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function formOf(state: DesignState): Form {
  return { accentColor: state.draft.accentColor, font: state.draft.font, logo: state.draft.logo };
}

function sameForm(a: Form, b: Form): boolean {
  return (
    a.accentColor === b.accentColor && a.font === b.font && (a.logo?.id ?? null) === (b.logo?.id ?? null)
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 412)
    return "Jemand hat das Aussehen inzwischen geändert. Bitte die Seite neu laden.";
  return e instanceof Error ? e.message : "Das hat nicht geklappt.";
}

export function DesignPage() {
  const shop = useShop();
  const design = useQuery({
    queryKey: designKey(shop.id),
    queryFn: () => request<DesignState>("/admin/v1/design", { shopId: shop.id }),
  });
  if (design.isPending)
    return (
      <div className="flex justify-center py-16 text-stone-400" role="status">
        <Spinner className="size-6" />
        <span className="sr-only">Aussehen wird geladen …</span>
      </div>
    );
  if (design.isError) return <Alert>{design.error.message}</Alert>;
  return <DesignEditor initial={design.data} />;
}

function DesignEditor({ initial }: { initial: DesignState }) {
  const shop = useShop();
  const queryClient = useQueryClient();
  const [server, setServer] = useState(initial);
  const [form, setForm] = useState<Form>(formOf(initial));
  const [hexText, setHexText] = useState(initial.draft.accentColor);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = !sameForm(form, formOf(server));
  const readable = readableWithWhite(form.accentColor);
  const unpublished = dirty || server.hasUnpublishedChanges;

  function accept(state: DesignState, keepLocal = false) {
    setServer(state);
    queryClient.setQueryData(designKey(shop.id), state);
    if (!keepLocal) {
      setForm(formOf(state));
      setHexText(state.draft.accentColor);
    }
  }

  function setColor(color: string) {
    setForm((f) => ({ ...f, accentColor: color }));
    setHexText(color);
    setMessage(undefined);
  }

  const saveDraft = async (): Promise<DesignState> =>
    request<DesignState>("/admin/v1/design/draft", {
      method: "PUT",
      shopId: shop.id,
      version: server.version,
      body: { accentColor: form.accentColor, font: form.font, logoImageId: form.logo?.id ?? null },
    });

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: (s) => {
      accept(s);
      setMessage({
        tone: "success",
        text: "Entwurf gespeichert. Im Shop ändert sich erst nach „Veröffentlichen“ etwas.",
      });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) accept(await saveDraft());
      return request<DesignState>("/admin/v1/design/publish", { method: "POST", shopId: shop.id });
    },
    onSuccess: (s) => {
      accept(s);
      setMessage({ tone: "success", text: "Veröffentlicht. Dein Shop zeigt jetzt das neue Aussehen." });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  const discard = useMutation({
    mutationFn: () => request<DesignState>("/admin/v1/design/discard", { method: "POST", shopId: shop.id }),
    onSuccess: (s) => {
      accept(s);
      setMessage({
        tone: "success",
        text: "Änderungen verworfen. Der Editor zeigt wieder, was im Shop zu sehen ist.",
      });
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!LOGO_TYPES.includes(file.type))
        throw new Error("Bitte das Logo als PNG, JPEG oder WebP hochladen (SVG geht noch nicht).");
      const data = await fileToBase64(file);
      return request<DesignState>("/admin/v1/design/logo", {
        method: "POST",
        shopId: shop.id,
        body: { data, filename: file.name },
      });
    },
    onSuccess: (s) => {
      // Farbe und Schrift, die noch nicht gespeichert sind, bleiben stehen; nur das Logo ist neu.
      accept(s, true);
      setForm((f) => ({ ...f, logo: s.draft.logo }));
      setMessage(undefined);
    },
    onError: (e) => setMessage({ tone: "error", text: errorText(e) }),
  });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file !== undefined) upload.mutate(file);
  }

  const busy = save.isPending || publish.isPending || discard.isPending || upload.isPending;
  const presetName = PRESETS.find((p) => p.color === form.accentColor)?.name;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aussehen</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            {unpublished ? (
              <Badge tone="amber">Nicht veröffentlichte Änderungen</Badge>
            ) : (
              <Badge tone="green">So sieht dein Shop gerade aus</Badge>
            )}
            <a
              href={storefrontUrl(shop.handle, window.location)}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-800 hover:underline"
            >
              Shop ansehen ↗
            </a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unpublished && (
            <Button
              variant="ghost"
              disabled={busy}
              busy={discard.isPending}
              onClick={() => {
                if (server.hasUnpublishedChanges) discard.mutate();
                else accept(server);
              }}
            >
              Verwerfen
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={!dirty || !readable || busy}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Entwurf speichern
          </Button>
          <Button
            disabled={!unpublished || !readable || busy}
            busy={publish.isPending}
            onClick={() => publish.mutate()}
          >
            Veröffentlichen
          </Button>
        </div>
      </div>

      <div className="mb-4 space-y-4" aria-live="polite">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Hauptfarbe">
            <p className="mb-3 text-sm text-stone-500">Für Knöpfe, Links und Markierungen im Shop.</p>
            <div role="radiogroup" aria-label="Fertige Farben" className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => {
                const active = p.color === form.accentColor;
                return (
                  <button
                    key={p.color}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setColor(p.color)}
                    className={
                      "flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs text-stone-700 ring-1 transition " +
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                      (active ? "bg-stone-50 ring-2 ring-stone-900" : "ring-stone-200 hover:bg-stone-50")
                    }
                  >
                    <Swatch color={p.color} />
                    {p.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-4">
              <label htmlFor="eigene-farbe" className="block text-sm font-medium text-stone-800">
                Eigene Farbe
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Farbe auswählen"
                  value={form.accentColor}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border-0 bg-white p-0.5 ring-1 ring-stone-300"
                />
                <Input
                  id="eigene-farbe"
                  value={hexText}
                  maxLength={7}
                  spellCheck={false}
                  aria-describedby="farbe-hinweis"
                  aria-invalid={readable ? undefined : true}
                  className="font-mono uppercase"
                  onChange={(e) => {
                    setHexText(e.target.value);
                    const hex = normalizeHex(e.target.value);
                    if (hex !== undefined) setForm((f) => ({ ...f, accentColor: hex }));
                  }}
                />
              </div>
              <p
                id="farbe-hinweis"
                className={"mt-1.5 text-xs " + (readable ? "text-stone-500" : "text-red-700")}
              >
                {readable
                  ? `${presetName ?? "Eigene Farbe"} · Kontrast zu weißer Schrift ${contrastWithWhite(form.accentColor).toFixed(1).replace(".", ",")} : 1, gut lesbar.`
                  : "Zu hell: Weiße Schrift auf Knöpfen wäre schlecht lesbar. Bitte eine dunklere Farbe wählen."}
              </p>
            </div>
          </Card>

          <Card title="Schrift">
            <div role="radiogroup" aria-label="Schrift" className="space-y-2">
              {FONTS.map((f) => {
                const active = f.id === form.font;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setForm((x) => ({ ...x, font: f.id }));
                      setMessage(undefined);
                    }}
                    className={
                      "flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2.5 text-left ring-1 transition " +
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 " +
                      (active ? "bg-stone-50 ring-2 ring-stone-900" : "ring-stone-200 hover:bg-stone-50")
                    }
                  >
                    <span className="text-lg text-stone-900" style={{ fontFamily: f.titel }}>
                      {f.name}
                    </span>
                    <span className="text-xs text-stone-500">{f.hint}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Logo">
            {form.logo ? (
              <div className="mb-3 flex items-center justify-center rounded-lg bg-stone-50 p-4 ring-1 ring-stone-200">
                <img src={form.logo.thumbnailUrl} alt="Dein Logo" className="max-h-16 w-auto" />
              </div>
            ) : (
              <p className="mb-3 text-sm text-stone-500">
                Ohne Logo steht oben im Shop der Name „{shop.name}“.
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              onChange={onFile}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                busy={upload.isPending}
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {form.logo ? "Anderes Logo" : "Logo hochladen"}
              </Button>
              {form.logo && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setForm((f) => ({ ...f, logo: null }))}
                >
                  Logo entfernen
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              PNG, JPEG oder WebP, am besten mit durchsichtigem Hintergrund.
            </p>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 text-sm font-medium text-stone-700">Vorschau</p>
          <Preview form={form} />
        </div>
      </div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="block size-7 rounded-full ring-1 ring-black/10"
      style={{ background: color }}
    />
  );
}

/** Nachbau des Shops mit den Farben der Storefront (shop.css) und echten Kategorien und Produkten. */
function Preview({ form }: { form: Form }) {
  const shop = useShop();
  const categories = useCategories(shop.id);
  const products = useQuery({
    queryKey: productsKey(shop.id),
    queryFn: () => listAll<Product>("/admin/v1/products", shop.id),
  });
  const font = fontOf(form.font);
  const accent = form.accentColor;
  const dark = darker(accent);
  const published = (products.data ?? []).filter((p) => p.status === "published").slice(0, 3);
  const shown: PreviewProduct[] =
    published.length > 0
      ? published.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price?.amount ?? null,
          image: p.images[0]?.thumbnailUrl,
        }))
      : placeholders;
  const cats = (categories.data ?? []).filter((c) => c.visible).slice(0, 4);
  const titel = { fontFamily: font.titel, fontWeight: 400 } as const;

  return (
    <div
      aria-label="Vorschau des Shops"
      role="img"
      className="overflow-hidden rounded-xl shadow-sm ring-1 ring-stone-200"
      style={{ background: "#fbf8f3", color: "#26221e", fontFamily: font.text }}
    >
      <div className="px-4 py-1.5 text-center text-xs" style={{ background: "#2f3a33", color: "#f4efe6" }}>
        Testshop: Hier ist nichts echt, auch die Zahlung nicht.
      </div>
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4"
        style={{ borderBottom: "1px solid #e2d9cb" }}
      >
        {form.logo ? (
          <img src={form.logo.thumbnailUrl} alt="" className="block max-h-10 w-auto max-w-40" />
        ) : (
          <span className="text-xl" style={titel}>
            {shop.name}
          </span>
        )}
        <span className="flex flex-wrap gap-4 text-sm">
          {cats.map((c, i) => (
            <span key={c.id} style={i === 0 ? { borderBottom: `2px solid ${accent}` } : undefined}>
              {c.name}
            </span>
          ))}
        </span>
        <span className="ml-auto text-sm">Warenkorb (0)</span>
      </div>
      <div className="px-5 py-6">
        <p className="text-3xl leading-tight" style={titel}>
          Willkommen bei {shop.name}
        </p>
        <p className="mt-2 text-sm">
          Schön, dass du da bist. Stöbere durch unser{" "}
          <span style={{ color: dark, textDecoration: "underline" }}>Sortiment</span>.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {shown.map((p) => (
            <div key={p.id} className="flex flex-col gap-1.5">
              {p.image ? (
                <img src={p.image} alt="" className="aspect-square w-full rounded-lg object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-lg" style={{ background: "#f1ebe1" }} />
              )}
              <span className="text-base leading-snug" style={titel}>
                {p.name}
              </span>
              <span className="text-sm">{p.price === null ? "–" : formatEuro(p.price)}</span>
              <span
                className="mt-1 inline-block self-start rounded-md px-3 py-1.5 text-xs font-semibold"
                style={{ background: accent, color: "#fff" }}
              >
                In den Warenkorb
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PreviewProduct {
  readonly id: string;
  readonly name: string;
  readonly price: number | null;
  readonly image: string | undefined;
}

/** Solange der Shop keine veröffentlichten Produkte hat. */
const placeholders: PreviewProduct[] = ["Erstes Produkt", "Zweites Produkt", "Drittes Produkt"].map(
  (name, i) => ({ id: `beispiel-${i}`, name, price: 990 + i * 500, image: undefined }),
);
