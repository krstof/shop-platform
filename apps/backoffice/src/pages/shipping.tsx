// Versandkosten: Pauschale und Grenze für kostenlosen Versand (API /admin/v1/shipping).
// Gilt sofort für Warenkörbe und neue Bestellungen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Spinner } from "../components/ui.js";
import { ApiError, request } from "../lib/api.js";
import { formatEuro } from "../lib/money.js";
import {
  parseShippingForm,
  shippingForm,
  shippingSummary,
  type ShippingForm,
  type ShippingSettings,
} from "../lib/shipping.js";
import { useShop } from "./layout.js";
import { SettingsTabs } from "./settings.js";

const shippingKey = (shopId: string) => ["shipping", shopId] as const;

export function ShippingPage() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: shippingKey(shop.id),
    queryFn: () => request<ShippingSettings>("/admin/v1/shipping", { shopId: shop.id }),
  });
  const [form, setForm] = useState<ShippingForm>({ amount: "", freeFrom: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof ShippingForm, string>>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings.data) setForm(shippingForm(settings.data));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (body: { amount: number; freeFrom: number | null }) =>
      request<ShippingSettings>("/admin/v1/shipping", { method: "PUT", body, shopId: shop.id }),
    onSuccess: (s) => {
      queryClient.setQueryData(shippingKey(shop.id), s);
      setSaved(true);
    },
  });

  const parsed = parseShippingForm(form);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    save.mutate(parsed.body);
  };
  const set = (key: keyof ShippingForm) => (value: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <div>
      <SettingsTabs current="versand" />
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Versand</h2>
        <p className="text-sm text-gray-500">
          Was der Versand innerhalb Deutschlands kostet. Gilt sofort im Shop; bestehende Bestellungen bleiben,
          wie sie sind.
        </p>
      </div>
      {settings.isPending && (
        <div className="flex justify-center py-10 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Versandkosten werden geladen …</span>
        </div>
      )}
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && (
        <Card title="Standardversand" className="max-w-2xl">
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Versandkosten (brutto)" hint="Leer lassen = kostenlos." error={errors.amount}>
                {(p) => (
                  <div className="relative">
                    <Input
                      {...p}
                      inputMode="decimal"
                      placeholder="kostenlos"
                      value={form.amount}
                      onChange={(e) => set("amount")(e.target.value)}
                      className="pr-8"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">
                      €
                    </span>
                  </div>
                )}
              </Field>
              <Field label="Kostenlos ab Warenwert" hint="Freiwillig, etwa 50,00." error={errors.freeFrom}>
                {(p) => (
                  <div className="relative">
                    <Input
                      {...p}
                      inputMode="decimal"
                      placeholder="keine Grenze"
                      value={form.freeFrom}
                      onChange={(e) => set("freeFrom")(e.target.value)}
                      className="pr-8"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">
                      €
                    </span>
                  </div>
                )}
              </Field>
            </div>
            {parsed.ok && (
              <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-200">
                <span className="font-medium">So sieht es im Shop aus: </span>
                {shippingSummary(parsed.body.amount, parsed.body.freeFrom, formatEuro)}
              </p>
            )}
            {save.isError && (
              <Alert>
                {save.error instanceof ApiError ? save.error.message : "Speichern hat nicht geklappt."}
              </Alert>
            )}
            {saved && <Alert tone="success">Gespeichert. Der Shop rechnet ab jetzt so.</Alert>}
            <Button type="submit" busy={save.isPending}>
              Speichern
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
