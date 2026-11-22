// Einstellungen → Anbindungen (21.11.2026).
//
// Die Seite kennt keine einzelne Anbindung: Sie baut sich aus dem, was die API liefert (Katalog im
// Modul integrations). Eine neue Anbindung erscheint hier automatisch, sobald sie dort eingetragen
// ist. Geheime Felder bekommt der Browser nie zurück; steht etwas drin, zeigt die Seite nur
// „hinterlegt" und lässt es leer, bis jemand einen neuen Wert eintippt.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Spinner } from "../components/ui.js";
import { ApiError, request } from "../lib/api.js";
import { storefrontUrl } from "../lib/design.js";
import { useShop } from "./layout.js";
import { SettingsTabs } from "./settings.js";

interface IntegrationField {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly secret: boolean;
  readonly required: boolean;
  readonly maxLength: number;
  readonly filled: boolean;
  readonly value: string;
}

interface Integration {
  readonly provider: string;
  readonly name: string;
  readonly description: string;
  readonly where: string;
  readonly setup: string;
  readonly helpUrl: string;
  readonly testable: boolean;
  readonly shopUrlPath: string;
  readonly enabled: boolean;
  readonly fields: readonly IntegrationField[];
  readonly checkedAt: string | null;
  readonly checkOk: boolean | null;
  readonly checkMessage: string | null;
}

export function IntegrationsPage() {
  const shop = useShop();
  const list = useQuery({
    queryKey: ["integrations", shop.id],
    queryFn: () => request<{ data: Integration[] }>("/admin/v1/integrations", { shopId: shop.id }),
  });
  // Breite wie auf den anderen Einstellungsseiten, damit die Überschrift beim Wechsel nicht springt
  // (Kristof 22.11.2026). Der Inhalt bleibt schmal, die Reiter stehen überall an derselben Stelle.
  return (
    <div>
      <SettingsTabs current="anbindungen" />
      <div className="max-w-3xl">
        <p className="mb-6 text-[0.95rem] text-gray-600">
          Hier verbindest du deinen Shop mit Diensten, die es schon gibt. Jede Anbindung ist einzeln an- und
          abschaltbar, und deine Zugangsdaten liegen verschlüsselt. Angezeigt bekommst du sie nie wieder.
        </p>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <Alert tone="error">Die Anbindungen ließen sich nicht laden.</Alert>
        ) : (
          <div className="space-y-4">
            {list.data.data.map((integration) => (
              <IntegrationCard key={integration.provider} integration={integration} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const shop = useShop();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(integration.fields.map((f) => [f.key, f.value])),
  );
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | undefined>();

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["integrations", shop.id] });
  };

  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      // Leere geheime Felder gar nicht erst schicken: Sonst würde ein hinterlegter Wert gelöscht,
      // nur weil das Feld aus Sicherheitsgründen leer angezeigt wird.
      const send = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => {
          const field = integration.fields.find((f) => f.key === key);
          return field !== undefined && (!field.secret || value !== "");
        }),
      );
      return request<Integration>("/admin/v1/integrations", {
        method: "PUT",
        shopId: shop.id,
        body: { provider: integration.provider, enabled, values: send },
      });
    },
    onSuccess: async (saved) => {
      setMessage({
        tone: "success",
        text: saved.enabled ? "Eingeschaltet und gespeichert." : "Gespeichert.",
      });
      setValues(Object.fromEntries(saved.fields.map((f) => [f.key, f.value])));
      await refresh();
    },
    onError: (error: unknown) => {
      setMessage({
        tone: "error",
        text: error instanceof ApiError ? error.message : "Das Speichern hat nicht geklappt.",
      });
    },
  });

  const test = useMutation({
    mutationFn: () =>
      request<{ ok: boolean; message: string }>("/admin/v1/integrations/test", {
        method: "POST",
        shopId: shop.id,
        body: { provider: integration.provider },
      }),
    onSuccess: async (result) => {
      setMessage({ tone: result.ok ? "success" : "error", text: result.message });
      await refresh();
    },
    onError: () => setMessage({ tone: "error", text: "Die Prüfung hat nicht geklappt." }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(undefined);
    save.mutate(true);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[1.05rem] font-semibold text-gray-900">{integration.name}</h2>
            <span
              className={
                "rounded-full px-2 py-0.5 text-xs font-medium " +
                (integration.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600")
              }
            >
              {integration.enabled ? "eingeschaltet" : "aus"}
            </span>
          </div>
          <p className="mt-1 text-[0.95rem] text-gray-600">{integration.description}</p>
          <p className="mt-1 text-sm text-gray-500">{integration.where}</p>
          {integration.shopUrlPath !== "" && (
            <p className="mt-2 text-sm text-gray-700">
              Adresse:{" "}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] break-all">
                {storefrontUrl(shop.handle, window.location) + integration.shopUrlPath}
              </code>
            </p>
          )}
          {integration.checkMessage !== null && (
            <p
              className={
                "mt-2 text-sm " + (integration.checkOk === true ? "text-green-700" : "text-amber-700")
              }
            >
              Letzte Prüfung: {integration.checkMessage}
            </p>
          )}
        </div>
        <Button type="button" variant="secondary" onClick={() => setOpen(!open)}>
          {open ? "Schließen" : integration.enabled ? "Ändern" : "Einrichten"}
        </Button>
      </div>

      {open && (
        <form onSubmit={submit} className="border-t border-gray-200 p-5">
          {integration.setup !== "" && (
            <div className="mb-4 rounded-lg bg-gray-50 p-4 text-[0.95rem] text-gray-700">
              <strong className="font-medium text-gray-900">So kommst du an die Zugangsdaten:</strong>{" "}
              {integration.setup}
              {integration.helpUrl !== "" && (
                <>
                  {" "}
                  <a
                    href={integration.helpUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-700 underline"
                  >
                    Anleitung des Anbieters
                  </a>
                </>
              )}
            </div>
          )}
          <div className="space-y-4">
            {integration.fields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                hint={
                  field.secret && field.filled
                    ? `${field.hint} Zurzeit ist ein Wert hinterlegt; leer lassen behält ihn.`
                    : field.hint
                }
              >
                {(props) => (
                  <Input
                    {...props}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    maxLength={field.maxLength}
                    placeholder={field.secret && field.filled ? "hinterlegt" : ""}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
          {message !== undefined && (
            <div className="mt-4">
              <Alert tone={message.tone}>{message.text}</Alert>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? "Speichert…"
                : integration.enabled
                  ? "Speichern"
                  : "Speichern und einschalten"}
            </Button>
            {integration.testable && (
              <Button
                type="button"
                variant="secondary"
                disabled={test.isPending}
                onClick={() => {
                  setMessage(undefined);
                  test.mutate();
                }}
              >
                {test.isPending ? "Prüft…" : "Verbindung prüfen"}
              </Button>
            )}
            {integration.enabled && (
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  setMessage(undefined);
                  save.mutate(false);
                }}
              >
                Ausschalten
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
