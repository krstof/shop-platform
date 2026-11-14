// Gutscheincodes: anlegen (Prozent oder fester Betrag, wahlweise Mindestwert), an- und abschalten,
// löschen. Kundinnen lösen sie im Warenkorb ein. API /admin/v1/coupons.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from "../components/ui.js";
import { ApiError, request } from "../lib/api.js";
import { couponLabel, parseCouponForm, type Coupon, type CouponForm } from "../lib/coupons.js";
import { formatEuro } from "../lib/money.js";
import { useShop } from "./layout.js";

const couponsKey = (shopId: string) => ["coupons", shopId] as const;
const emptyForm: CouponForm = { code: "", kind: "percent", value: "", minOrder: "" };

export function CouponsPage() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const coupons = useQuery({
    queryKey: couponsKey(shop.id),
    queryFn: async () => (await request<{ data: Coupon[] }>("/admin/v1/coupons", { shopId: shop.id })).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: couponsKey(shop.id) });
  const toggle = useMutation({
    mutationFn: (c: Coupon) =>
      request<Coupon>(`/admin/v1/coupons/${c.id}`, {
        method: "PATCH",
        body: { active: !c.active },
        shopId: shop.id,
      }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (c: Coupon) => request(`/admin/v1/coupons/${c.id}`, { method: "DELETE", shopId: shop.id }),
    onSettled: refresh,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Gutscheine</h1>
        <p className="text-sm text-stone-500">
          Codes, die Kundinnen im Warenkorb eingeben, etwa SOMMER10 für 10 % Rabatt auf den Warenwert.
        </p>
      </div>
      <NewCouponCard onCreated={refresh} />
      <h2 className="mt-8 mb-3 text-lg font-semibold">Alle Gutscheine</h2>
      {(toggle.isError || remove.isError) && (
        <div className="mb-4">
          <Alert>{(toggle.error ?? remove.error)?.message ?? "Das hat nicht geklappt."}</Alert>
        </div>
      )}
      {coupons.isPending && (
        <div className="flex justify-center py-10 text-stone-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Gutscheine werden geladen …</span>
        </div>
      )}
      {coupons.isError && <Alert>{coupons.error.message}</Alert>}
      {coupons.data?.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-10 text-center text-sm text-stone-500">
          Noch keine Gutscheine.
        </div>
      )}
      {coupons.data && coupons.data.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
          {coupons.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono font-medium tracking-wide text-stone-900">{c.code}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <span>{couponLabel(c, formatEuro)}</span>
                  {c.active ? <Badge tone="green">Aktiv</Badge> : <Badge tone="stone">Aus</Badge>}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                busy={toggle.isPending && toggle.variables?.id === c.id}
                onClick={() => toggle.mutate(c)}
              >
                {c.active ? "Abschalten" : "Einschalten"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                busy={remove.isPending && remove.variables?.id === c.id}
                onClick={() => {
                  if (window.confirm(`Gutschein ${c.code} löschen? Bestellungen behalten ihren Rabatt.`))
                    remove.mutate(c);
                }}
              >
                Löschen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewCouponCard({ onCreated }: { onCreated: () => unknown }) {
  const shop = useShop();
  const [form, setForm] = useState<CouponForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof CouponForm, string>>>({});
  const [done, setDone] = useState<string | undefined>();
  const create = useMutation({
    mutationFn: (body: object) =>
      request<Coupon>("/admin/v1/coupons", { method: "POST", body, shopId: shop.id }),
    onSuccess: (c) => {
      setDone(c.code);
      setForm(emptyForm);
      void onCreated();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.field("/body/code") : undefined;
      const value = e instanceof ApiError ? e.field("/body/value") : undefined;
      if (code !== undefined || value !== undefined)
        setErrors({ ...(code === undefined ? {} : { code }), ...(value === undefined ? {} : { value }) });
    },
  });
  const set = (k: keyof CouponForm) => (v: string) => {
    setDone(undefined);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseCouponForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    create.mutate(parsed.body);
  };
  return (
    <Card title="Neuer Gutschein">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" hint="Buchstaben, Ziffern, Bindestrich." error={errors.code}>
            {(p) => (
              <Input
                {...p}
                value={form.code}
                maxLength={32}
                placeholder="SOMMER10"
                className="font-mono uppercase"
                onChange={(e) => set("code")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Art">
            {(p) => (
              <Select {...p} value={form.kind} onChange={(e) => set("kind")(e.target.value)}>
                <option value="percent">Prozent vom Warenwert</option>
                <option value="amount">Fester Betrag in Euro</option>
              </Select>
            )}
          </Field>
          <Field label={form.kind === "percent" ? "Rabatt in %" : "Rabatt in €"} error={errors.value}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={form.value}
                placeholder={form.kind === "percent" ? "10" : "5,00"}
                onChange={(e) => set("value")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Ab Warenwert (€)" hint="Freiwillig." error={errors.minOrder}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={form.minOrder}
                placeholder="keine Grenze"
                onChange={(e) => set("minOrder")(e.target.value)}
              />
            )}
          </Field>
        </div>
        {create.isError && errors.code === undefined && errors.value === undefined && (
          <Alert>{create.error.message}</Alert>
        )}
        {done !== undefined && <Alert tone="success">Gutschein {done} ist angelegt und gilt sofort.</Alert>}
        <Button type="submit" busy={create.isPending}>
          Gutschein anlegen
        </Button>
      </form>
    </Card>
  );
}
