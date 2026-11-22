// Einstellungen (14.11.2026): Reiter „Allgemein“ (Adresse, Geschäftsangaben, Shop-Status, Shop-Name),
// „Versand“ und „Team“. Allgemein speichert über PUT /admin/v1/settings/general (mit Version).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Field, Input, Select, Spinner } from "../components/ui.js";
import { ApiError, imageUploadData, request, type DesignState } from "../lib/api.js";
import { designFaviconKey } from "../lib/shop-icon.js";
import { useShop } from "./layout.js";

const SYMBOL_TYPEN = ["image/png", "image/jpeg", "image/webp"];

export interface GeneralSettings {
  readonly shopName: string;
  readonly shopOpen: boolean;
  readonly address: Address;
  readonly vatId: string;
  readonly tradeRegister: string;
  readonly version: number;
}

interface Address {
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  fax: string;
  country: string;
  street: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  region: string;
}

export const COUNTRY_NAMES: readonly (readonly [string, string])[] = [
  ["DE", "Deutschland"],
  ["AT", "Österreich"],
  ["CH", "Schweiz"],
  ["NL", "Niederlande"],
  ["BE", "Belgien"],
  ["LU", "Luxemburg"],
  ["FR", "Frankreich"],
  ["DK", "Dänemark"],
  ["PL", "Polen"],
  ["CZ", "Tschechien"],
  ["IT", "Italien"],
  ["ES", "Spanien"],
];

/** Reiter oben auf allen Einstellungsseiten. */
export function SettingsTabs({ current }: { current: "allgemein" | "versand" | "anbindungen" | "team" }) {
  const shop = useShop();
  const tabs = [
    { id: "allgemein", to: "/$shop/einstellungen/allgemein", label: "Allgemein" },
    { id: "versand", to: "/$shop/versand", label: "Versand" },
    { id: "anbindungen", to: "/$shop/einstellungen/anbindungen", label: "Anbindungen" },
    ...(shop.role === "owner" ? [{ id: "team", to: "/$shop/team", label: "Team" }] : []),
  ] as const;
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Einstellungen</h1>
      <nav aria-label="Einstellungen" className="mt-4 flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.id}
            to={t.to}
            params={{ shop: shop.handle }}
            aria-current={current === t.id ? "page" : undefined}
            className={
              "-mb-px border-b-2 px-3 py-2 text-[0.95rem] transition " +
              (current === t.id
                ? "border-brand-600 font-medium text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-900")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

const key = (shopId: string) => ["settings-general", shopId] as const;

export function GeneralSettingsPage() {
  const shop = useShop();
  const settings = useQuery({
    queryKey: key(shop.id),
    queryFn: () => request<GeneralSettings>("/admin/v1/settings/general", { shopId: shop.id }),
  });
  return (
    <div>
      <SettingsTabs current="allgemein" />
      {settings.isPending && (
        <div className="flex justify-center py-10 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Einstellungen werden geladen …</span>
        </div>
      )}
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && <GeneralForm initial={settings.data} />}
      {settings.data && <FaviconCard />}
    </div>
  );
}

/**
 * Symbol des Shops (Kristof 22.11.2026): das kleine Bild im Browser-Reiter, das auch in der
 * Kopfzeile des Backoffice neben dem Shopnamen steht. Es wirkt sofort, ohne Veröffentlichen im
 * Editor, weil es zum Shop gehört und nicht zum Aussehen, das man erst ansehen möchte.
 */
function FaviconCard() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const datei = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | undefined>();
  const design = useQuery({
    queryKey: ["design", shop.id] as const,
    queryFn: () => request<DesignState>("/admin/v1/design", { shopId: shop.id }),
  });
  const symbol = design.data?.published.favicon ?? null;
  const frisch = (s: DesignState) => {
    queryClient.setQueryData(["design", shop.id], s);
    void queryClient.invalidateQueries({ queryKey: designFaviconKey(shop.id) });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!SYMBOL_TYPEN.includes(file.type))
        throw new Error("Bitte das Symbol als PNG, JPEG oder WebP hochladen.");
      return request<DesignState>("/admin/v1/design/favicon", {
        method: "POST",
        shopId: shop.id,
        body: await imageUploadData(file),
      });
    },
    onSuccess: (s) => {
      frisch(s);
      setMessage({ tone: "success", text: "Symbol gespeichert. Es gilt sofort." });
    },
    onError: (e) =>
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Hat nicht geklappt." }),
  });
  const remove = useMutation({
    mutationFn: () => request<DesignState>("/admin/v1/design/favicon", { method: "DELETE", shopId: shop.id }),
    onSuccess: (s) => {
      frisch(s);
      setMessage({ tone: "success", text: "Symbol entfernt." });
    },
    onError: (e) =>
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Hat nicht geklappt." }),
  });

  return (
    <section className="mt-6 max-w-3xl rounded-lg bg-white p-5 ring-1 ring-gray-200">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-[1.05rem] font-semibold text-gray-900">
        Symbol des Shops
      </h2>
      <p className="text-[0.95rem] text-gray-600">
        Das kleine Bild im Browser-Reiter, in Lesezeichen und hier oben neben dem Shopnamen. Am besten
        quadratisch, PNG mit durchsichtigem Hintergrund. Es gilt sofort.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-lg bg-gray-50 ring-1 ring-gray-200">
          {symbol ? (
            <img src={symbol.thumbnailUrl} alt="" className="size-10 object-contain" />
          ) : (
            <span className="text-xs text-gray-400">keins</span>
          )}
        </span>
        <input
          ref={datei}
          type="file"
          accept={SYMBOL_TYPEN.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          busy={upload.isPending}
          onClick={() => datei.current?.click()}
        >
          {symbol ? "Anderes Bild wählen" : "Bild auswählen"}
        </Button>
        {symbol && (
          <Button type="button" variant="ghost" busy={remove.isPending} onClick={() => remove.mutate()}>
            Entfernen
          </Button>
        )}
      </div>
      {message && (
        <div className="mt-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
    </section>
  );
}

const REQUIRED: readonly (keyof Address)[] = [
  "firstName",
  "lastName",
  "email",
  "street",
  "postalCode",
  "city",
];

function GeneralForm({ initial }: { initial: GeneralSettings }) {
  const shop = useShop();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | undefined>();
  const [serverErrors, setServerErrors] = useState<ApiError | undefined>();
  useEffect(() => setForm(initial), [initial]);

  const addr = (k: keyof Address, v: string) => {
    setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
    setMessage(undefined);
  };
  const missing = (k: keyof Address) => touched && REQUIRED.includes(k) && form.address[k].trim() === "";
  const err = (k: keyof Address) =>
    missing(k) ? "Bitte ausfüllen." : serverErrors?.field(`/body/address/${k}`);

  const save = useMutation({
    mutationFn: () =>
      request<GeneralSettings>("/admin/v1/settings/general", {
        method: "PUT",
        shopId: shop.id,
        version: form.version,
        body: {
          shopName: form.shopName,
          shopOpen: form.shopOpen,
          address: form.address,
          vatId: form.vatId,
          tradeRegister: form.tradeRegister,
        },
      }),
    onSuccess: async (s) => {
      queryClient.setQueryData(key(shop.id), s);
      setForm(s);
      setServerErrors(undefined);
      setMessage({ tone: "success", text: "Gespeichert." });
      // Der Shop-Name steht auch in der Sitzung (Menü, Kopfzeile).
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => {
      setServerErrors(e instanceof ApiError ? e : undefined);
      setMessage({
        tone: "error",
        text:
          e instanceof ApiError && e.status === 412
            ? "Jemand hat die Einstellungen inzwischen geändert. Bitte die Seite neu laden."
            : e instanceof Error
              ? e.message
              : "Speichern hat nicht geklappt.",
      });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (REQUIRED.some((k) => form.address[k].trim() === "") || form.shopName.trim() === "") {
      setMessage({ tone: "error", text: "Bitte alle Pflichtfelder (*) ausfüllen." });
      return;
    }
    save.mutate();
  }

  const text = (
    k: keyof Address,
    label: string,
    opts: { required?: boolean; type?: string; auto?: string } = {},
  ) => (
    <Field label={opts.required ? `${label} *` : label} error={err(k)}>
      {(p) => (
        <Input
          {...p}
          type={opts.type ?? "text"}
          autoComplete={opts.auto}
          value={form.address[k]}
          onChange={(e) => addr(k, e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Group title="Adresse">
            {text("company", "Firma", { auto: "organization" })}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("firstName", "Vorname", { required: true, auto: "given-name" })}
              {text("lastName", "Nachname", { required: true, auto: "family-name" })}
            </div>
            {text("email", "E-Mail-Adresse", { required: true, type: "email", auto: "email" })}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("phone", "Telefon", { type: "tel", auto: "tel" })}
              {text("fax", "Fax", { type: "tel" })}
            </div>
            <Field label="Land *">
              {(p) => (
                <Select {...p} value={form.address.country} onChange={(e) => addr("country", e.target.value)}>
                  {COUNTRY_NAMES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {text("street", "Straße und Hausnummer", { required: true, auto: "street-address" })}
            {text("addressLine2", "Adresszusatz")}
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              {text("postalCode", "Postleitzahl", { required: true, auto: "postal-code" })}
              {text("city", "Stadt", { required: true, auto: "address-level2" })}
            </div>
            {text("region", "Bundesland", { auto: "address-level1" })}
          </Group>
          <Group title="Geschäftliche Informationen">
            <Field label="USt-IdNr." hint="Beispiel: DE 123456789" error={serverErrors?.field("/body/vatId")}>
              {(p) => (
                <Input
                  {...p}
                  value={form.vatId}
                  onChange={(e) => setForm({ ...form, vatId: e.target.value })}
                />
              )}
            </Field>
            <Field label="Handelsregister" hint="Beispiel: Amtsgericht Berlin, HRB 12345">
              {(p) => (
                <Input
                  {...p}
                  value={form.tradeRegister}
                  onChange={(e) => setForm({ ...form, tradeRegister: e.target.value })}
                />
              )}
            </Field>
          </Group>
        </div>
        <div className="space-y-6">
          <Group title="Shop-Status">
            <fieldset>
              <legend className="text-sm font-medium text-gray-800">Shop ist geöffnet</legend>
              <p className="text-xs text-gray-500">
                Geschlossen: Besucher sehen nur einen Hinweis „Gerade geschlossen“.
              </p>
              <div className="mt-2 flex gap-5 text-sm">
                {[true, false].map((v) => (
                  <label key={String(v)} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="shop-offen"
                      checked={form.shopOpen === v}
                      onChange={() => setForm({ ...form, shopOpen: v })}
                    />
                    {v ? "Ja" : "Nein"}
                  </label>
                ))}
              </div>
            </fieldset>
          </Group>
          <Group title="Shop-Details">
            <Field
              label="Shop-Name *"
              hint="Steht im Shop oben, im Browser-Tab und in E-Mails."
              error={
                touched && form.shopName.trim() === ""
                  ? "Bitte ausfüllen."
                  : serverErrors?.field("/body/shopName")
              }
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.shopName}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                />
              )}
            </Field>
          </Group>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" busy={save.isPending}>
          Speichern
        </Button>
        {message && (
          <div className="min-w-0 flex-1">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        )}
      </div>
    </form>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-5 ring-1 ring-gray-200">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-[1.05rem] font-semibold text-gray-900">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
