// Posteingang: Nachrichten aus dem Kontaktformular des Shops (/<shop>/kontakt). Links die Liste
// (ungelesene fett mit Punkt), rechts bzw. darunter die gewählte Nachricht mit „Antworten“ (öffnet das
// E-Mail-Programm), „Als ungelesen markieren“ und „Löschen“. Öffnen markiert als gelesen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Mail, Reply, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../components/dialog.js";
import { Alert, Button, Spinner } from "../components/ui.js";
import { storefrontUrl } from "../lib/design.js";
import { request } from "../lib/api.js";
import { inboxKey, messageTitle, receivedAt, replyLink, type ContactMessage } from "../lib/inbox.js";
import { useShop } from "./layout.js";

export function InboxPage() {
  const shop = useShop();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const messages = useQuery({
    queryKey: inboxKey(shop.id),
    queryFn: () =>
      request<{ data: ContactMessage[]; unread: number }>("/admin/v1/contact-messages", { shopId: shop.id }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: inboxKey(shop.id) });
  const mark = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      request<ContactMessage>(`/admin/v1/contact-messages/${id}`, {
        method: "PATCH",
        body: { read },
        shopId: shop.id,
      }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      request(`/admin/v1/contact-messages/${id}`, { method: "DELETE", shopId: shop.id }),
    onSuccess: () => setSelectedId(undefined),
    onSettled: refresh,
  });

  const list = messages.data?.data ?? [];
  const selected = list.find((m) => m.id === selectedId);
  // Öffnen heißt gelesen.
  useEffect(() => {
    if (selected !== undefined && !selected.read && !mark.isPending)
      mark.mutate({ id: selected.id, read: true });
  }, [selected?.id, selected?.read]);

  // Am Handy steht die Nachricht unter der Liste: dorthin springen.
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedId !== undefined && window.innerWidth < 768)
      article.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  const unread = messages.data?.unread ?? 0;
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">Posteingang</h1>
        <p className="text-sm text-gray-500">
          Nachrichten aus dem{" "}
          <a
            href={`${storefrontUrl(shop.handle, window.location)}/kontakt`}
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 underline underline-offset-2"
          >
            Kontaktformular deines Shops
          </a>
          .{unread > 0 && ` ${unread === 1 ? "1 ungelesene" : `${unread} ungelesene`}.`}
        </p>
      </div>
      {(mark.isError || remove.isError) && (
        <div className="mb-4">
          <Alert>{(mark.error ?? remove.error)?.message ?? "Das hat nicht geklappt."}</Alert>
        </div>
      )}
      {messages.isPending && (
        <div className="flex justify-center py-10 text-gray-400" role="status">
          <Spinner className="size-6" />
          <span className="sr-only">Nachrichten werden geladen …</span>
        </div>
      )}
      {messages.isError && <Alert>{messages.error.message}</Alert>}
      {messages.data && list.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-12 text-center text-sm text-gray-500">
          <Inbox className="mx-auto mb-3 size-8 text-gray-300" aria-hidden="true" />
          Noch keine Nachrichten. Sobald jemand das Kontaktformular im Shop abschickt, steht es hier.
        </div>
      )}
      {list.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <ul
            aria-label="Nachrichten"
            className="divide-y divide-gray-100 self-start overflow-hidden rounded-lg bg-white ring-1 ring-gray-200"
          >
            {list.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  aria-current={m.id === selectedId ? "true" : undefined}
                  className={
                    "flex w-full gap-2.5 px-4 py-3 text-left transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 " +
                    (m.id === selectedId ? "bg-brand-50/60" : "")
                  }
                >
                  <span
                    className={"mt-1.5 size-2 shrink-0 rounded-full " + (m.read ? "" : "bg-brand-500")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={"truncate " + (m.read ? "text-gray-700" : "font-semibold text-gray-900")}
                      >
                        {m.name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">{receivedAt(m.createdAt)}</span>
                    </span>
                    <span
                      className={
                        "block truncate text-sm " + (m.read ? "text-gray-500" : "font-medium text-gray-800")
                      }
                    >
                      {!m.read && <span className="sr-only">Ungelesen: </span>}
                      {messageTitle(m)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {selected === undefined ? (
              <div className="hidden rounded-lg border border-dashed border-gray-300 px-6 py-16 text-center text-sm text-gray-400 md:block">
                <Mail className="mx-auto mb-3 size-7 text-gray-300" aria-hidden="true" />
                Wähle links eine Nachricht.
              </div>
            ) : (
              <article
                ref={article}
                className="scroll-mt-20 rounded-lg bg-white p-5 ring-1 ring-gray-200"
                aria-label="Nachricht"
              >
                <h2 className="text-lg font-semibold text-gray-900">
                  {selected.subject.trim() === "" ? "(ohne Betreff)" : selected.subject}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Von <span className="font-medium text-gray-800">{selected.name}</span> &lt;
                  <a
                    href={`mailto:${selected.email}`}
                    className="text-brand-700 underline underline-offset-2"
                  >
                    {selected.email}
                  </a>
                  &gt; · {receivedAt(selected.createdAt)}
                </p>
                <p className="mt-4 text-[15px] leading-relaxed whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere]">
                  {selected.message}
                </p>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                  <a
                    href={replyLink(selected, shop.name)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <Reply className="size-4" aria-hidden="true" />
                    Antworten
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    busy={mark.isPending}
                    onClick={() => {
                      mark.mutate({ id: selected.id, read: false });
                      setSelectedId(undefined);
                    }}
                  >
                    Als ungelesen markieren
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    busy={remove.isPending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Nachricht löschen?",
                          message: `Die Nachricht von ${selected.name} wird endgültig gelöscht.`,
                          confirmLabel: "Löschen",
                          tone: "danger",
                        })
                      )
                        remove.mutate(selected.id);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Löschen
                  </Button>
                </div>
                <p className="mt-3 text-xs text-gray-400">
                  „Antworten“ öffnet dein E-Mail-Programm mit der Adresse und der zitierten Nachricht.
                </p>
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
