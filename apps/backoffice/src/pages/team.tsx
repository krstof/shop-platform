// Team: Wer arbeitet im Shop mit? Die Inhaberin lädt Kolleginnen per E-Mail ein und entfernt sie
// wieder. Nutzt /admin/v1/members (E6 Teil 7). Einladen verlangt eine frische Passworteingabe
// (403 reauthentication_required); dann fragt die Seite das Passwort ab und versucht es erneut.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, Spinner } from "../components/ui.js";
import { ApiError, listAll, request } from "../lib/api.js";
import {
  looksLikeEmail,
  roleLabel,
  sortMembers,
  statusLabel,
  type InvitedMember,
  type Member,
} from "../lib/team.js";
import { useShop } from "./layout.js";

const membersKey = (shopId: string) => ["members", shopId] as const;

export function TeamPage() {
  const shop = useShop();
  if (shop.role !== "owner")
    return (
      <div>
        <h1 className="mb-4 text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Team</h1>
        <Alert>Nur die Inhaberin oder der Inhaber des Shops kann das Team verwalten.</Alert>
      </div>
    );
  return <TeamOwnerView />;
}

function TeamOwnerView() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: membersKey(shop.id),
    queryFn: async () => sortMembers(await listAll<Member>("/admin/v1/members", shop.id)),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => request(`/admin/v1/members/${m.id}`, { method: "DELETE", shopId: shop.id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: membersKey(shop.id) }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Team</h1>
        <p className="text-sm text-gray-500">
          Lade Kolleginnen und Kollegen ein. Sie können dann Produkte, Kategorien, Bestellungen und das
          Aussehen bearbeiten, aber kein Team verwalten.
        </p>
      </div>

      <InviteCard onInvited={() => queryClient.invalidateQueries({ queryKey: membersKey(shop.id) })} />

      <h2 className="mt-8 mb-3 text-lg font-semibold">Mitglieder</h2>
      {remove.isError && (
        <div className="mb-4">
          <Alert>{remove.error instanceof ApiError ? remove.error.message : "Das hat nicht geklappt."}</Alert>
        </div>
      )}
      {members.isPending && (
        <div className="flex justify-center py-10 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Team wird geladen …</span>
        </div>
      )}
      {members.isError && <Alert>{members.error.message}</Alert>}
      {members.data && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
          {members.data.map((m) => {
            const status = statusLabel(m.status);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{m.name ?? m.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {m.name !== null && <span className="truncate">{m.email}</span>}
                    <span>{roleLabel(m.role)}</span>
                    <Badge tone={status.tone}>{status.text}</Badge>
                  </div>
                </div>
                {m.role !== "owner" && (
                  <Button
                    type="button"
                    variant="ghost"
                    busy={remove.isPending && remove.variables?.id === m.id}
                    onClick={() => {
                      const question =
                        m.status === "invited"
                          ? `Einladung an ${m.email} zurückziehen?`
                          : `${m.email} aus dem Team entfernen? Der Zugang zum Shop endet sofort.`;
                      if (window.confirm(question)) remove.mutate(m);
                    }}
                  >
                    {m.status === "invited" ? "Zurückziehen" : "Entfernen"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** E-Mail eingeben, einladen; fragt bei Bedarf einmal das Passwort ab. */
function InviteCard({ onInvited }: { onInvited: () => unknown }) {
  const shop = useShop();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [done, setDone] = useState<InvitedMember | undefined>();

  const invite = useMutation({
    mutationFn: async () => {
      if (needPassword) await request("/auth/v1/confirm-password", { method: "POST", body: { password } });
      return request<InvitedMember>("/admin/v1/members", {
        method: "POST",
        body: { email: email.trim(), role: "staff" },
        shopId: shop.id,
      });
    },
    onSuccess: (m) => {
      setDone(m);
      setEmail("");
      setPassword("");
      setNeedPassword(false);
      void onInvited();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "reauthentication_required") {
        setNeedPassword(true);
        setError(undefined);
        return;
      }
      if (e instanceof ApiError && e.status === 401 && needPassword) {
        setError("Das Passwort stimmt nicht.");
        return;
      }
      const field = e instanceof ApiError ? e.field("/body/email") : undefined;
      if (field !== undefined) setFieldError(field);
      else setError(e instanceof ApiError ? e.message : "Einladen hat nicht geklappt.");
    },
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setError(undefined);
    setFieldError(undefined);
    setDone(undefined);
    if (!looksLikeEmail(email)) {
      setFieldError("Bitte eine E-Mail-Adresse wie kim@example.org angeben.");
      return;
    }
    if (needPassword && password === "") {
      setError("Bitte dein Passwort eingeben.");
      return;
    }
    invite.mutate();
  };

  return (
    <Card title="Jemanden einladen">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="E-Mail-Adresse" error={fieldError}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="off"
              value={email}
              maxLength={320}
              placeholder="kollegin@example.org"
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        {needPassword && (
          <Field label="Dein Passwort" hint="Zur Sicherheit vor dem Einladen. Gilt danach 15 Minuten.">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        )}
        {error !== undefined && <Alert>{error}</Alert>}
        {done !== undefined && (
          <Alert tone="success">
            {done.invitationSent
              ? `Einladung an ${done.email} ist unterwegs. Der Link in der E-Mail gilt 7 Tage.`
              : `${done.email} ist eingeladen, aber die E-Mail ging gerade nicht hinaus. Bitte später noch einmal einladen.`}{" "}
            Auf dem Testserver landen alle E-Mails im Test-Postfach (Mailpit), nicht beim echten Empfänger.
          </Alert>
        )}
        <Button type="submit" busy={invite.isPending}>
          {needPassword ? "Bestätigen und einladen" : "Einladen"}
        </Button>
      </form>
    </Card>
  );
}
