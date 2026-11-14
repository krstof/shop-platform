// KI-Assistent (Welle 2): Chat mit dem Sprachmodell. Lesende Werkzeuge laufen sofort, ändernde erst
// nach „Ausführen“. Alles läuft über die Admin-API mit der Sitzung des Händlers (lib/assistant.ts).
// Der Verlauf bleibt nur in diesem Browser-Tab (sessionStorage), auf dem Server wird nichts gespeichert.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SlopifyMark } from "../components/logo.js";
import { Alert, Button, Spinner, Textarea } from "../components/ui.js";
import { ApiError, request, type Order, type Product } from "../lib/api.js";
import {
  describeChange,
  needsConfirmation,
  runTool,
  toolLabel,
  type AssistantStatus,
  type ChatBlock,
  type ChatMessage,
} from "../lib/assistant.js";
import { useShop } from "./layout.js";

type ToolUse = Extract<ChatBlock, { type: "tool_use" }>;
type Decision = "approved" | "declined";

const SUGGESTIONS = [
  "Welche Bestellungen muss ich noch versenden?",
  "Leg ein neues Produkt an: Earl Grey, 6,90 €, 50 Stück, gleich im Shop.",
  "Welche Produkte haben weniger als 10 Stück auf Lager?",
];
/** Höchstens so viele Antworten des Modells am Stück, ohne dass der Mensch etwas schreibt. */
const MAX_ROUNDS = 8;

function storageKey(shopId: string) {
  return `slopify-assistent:${shopId}`;
}

function loadHistory(shopId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(shopId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(shopId: string, messages: readonly ChatMessage[]) {
  try {
    sessionStorage.setItem(storageKey(shopId), JSON.stringify(messages));
  } catch {
    // Kein Speicher (privates Fenster): Der Verlauf hält dann nur, solange die Seite offen ist.
  }
}

function toolUses(m: ChatMessage | undefined): ToolUse[] {
  if (m?.role !== "assistant") return [];
  return m.content.filter((b): b is ToolUse => b.type === "tool_use");
}

export function AssistantPage() {
  const shop = useShop();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["assistant", shop.id],
    queryFn: () => request<AssistantStatus>("/admin/v1/assistant", { shopId: shop.id }),
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(shop.id));
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    saveHistory(shop.id, messages);
  }, [shop.id, messages]);
  useEffect(() => {
    // Neuere Browser geben hier ein Promise zurück; ein Effekt darf nur eine Aufräumfunktion liefern.
    void endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  const update = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** Treibt das Gespräch weiter, bis das Modell fertig ist oder eine Bestätigung fehlt. */
  const advance = useCallback(
    async (start: ChatMessage[], decided: Record<string, Decision>) => {
      let current = start;
      setError(null);
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const last = current.at(-1);
          if (last?.role === "assistant") {
            const uses = toolUses(last);
            if (uses.length === 0) return;
            if (uses.some((u) => needsConfirmation(u.name, status.data) && decided[u.id] === undefined))
              return;
            const results: ChatBlock[] = [];
            let changed = false;
            for (const u of uses) {
              if (needsConfirmation(u.name, status.data) && decided[u.id] === "declined") {
                results.push({
                  type: "tool_result",
                  tool_use_id: u.id,
                  content: "Abgelehnt: Die Person will das nicht.",
                });
                continue;
              }
              setBusy(
                needsConfirmation(u.name, status.data) ? "Wird ausgeführt …" : `${toolLabel(u.name)} …`,
              );
              const r = await runTool(u.name, u.input, shop.id);
              changed ||= needsConfirmation(u.name, status.data) && !r.isError;
              results.push({
                type: "tool_result",
                tool_use_id: u.id,
                content: r.content,
                ...(r.isError ? { is_error: true } : {}),
              });
            }
            if (changed) void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === shop.id });
            current = [...current, { role: "user", content: results }];
            update(current);
          }
          setBusy("Denkt nach …");
          const reply = await request<{ content: ChatBlock[] }>("/admin/v1/assistant/chat", {
            method: "POST",
            shopId: shop.id,
            body: { messages: current },
          });
          current = [...current, { role: "assistant", content: reply.content }];
          update(current);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Da ist etwas schiefgegangen.");
      } finally {
        setBusy(null);
        void queryClient.invalidateQueries({ queryKey: ["assistant", shop.id] });
      }
    },
    [queryClient, shop.id, status.data, update],
  );

  const send = (value: string) => {
    const t = value.trim();
    if (t === "" || busy !== null) return;
    setText("");
    // Offene Rückfragen ohne Antwort gelten als abgelehnt, sonst passt der Verlauf nicht mehr.
    let base = messagesRef.current;
    const open = toolUses(base.at(-1));
    if (open.length > 0)
      base = [
        ...base,
        {
          role: "user",
          content: open.map((u) => ({
            type: "tool_result" as const,
            tool_use_id: u.id,
            content: "Nicht ausgeführt: Die Person hat stattdessen etwas Neues geschrieben.",
          })),
        },
      ];
    const next: ChatMessage[] = [...base, { role: "user", content: [{ type: "text", text: t }] }];
    // Zwei Nachrichten der Person hintereinander zusammenlegen (die API erwartet abwechselnde Rollen).
    const merged = mergeUserTurns(next);
    update(merged);
    void advance(merged, decisions);
  };

  const decide = (id: string, decision: Decision) => {
    const next = { ...decisions, [id]: decision };
    setDecisions(next);
    void advance(messagesRef.current, next);
  };

  const reset = () => {
    update([]);
    setDecisions({});
    setError(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const results = new Map<string, Extract<ChatBlock, { type: "tool_result" }>>();
  for (const m of messages)
    for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);

  const unavailable = status.data !== undefined && !status.data.available;

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <SlopifyMark className="size-7" /> Assistent
          </h1>
          <p className="text-sm text-stone-500">
            Sag einfach, was du brauchst. Änderungen führe ich erst aus, wenn du sie bestätigst.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="secondary" className="shrink-0" onClick={reset} disabled={busy !== null}>
            Neuer Chat
          </Button>
        )}
      </div>

      {unavailable && (
        <Alert tone="info">
          Der Assistent ist auf diesem Server noch nicht eingerichtet. Es fehlt der Zugang zum Sprachmodell.
        </Alert>
      )}

      <div className="space-y-4" aria-live="polite">
        {messages.length === 0 && !unavailable && (
          <div className="rounded-xl border-2 border-dashed border-stone-300 px-6 py-10 text-center">
            <p className="font-medium">Womit kann ich helfen?</p>
            <div className="mt-4 flex flex-col items-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
                  onClick={() => send(s)}
                  disabled={busy !== null || status.isPending}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Fragment key={i}>
            {m.content.map((b, j) => {
              if (b.type === "text")
                return (
                  <Bubble key={j} mine={m.role === "user"}>
                    <RichText text={b.text} />
                  </Bubble>
                );
              if (b.type === "tool_use") {
                const result = results.get(b.id);
                if (!needsConfirmation(b.name, status.data))
                  return (
                    <p key={j} className="pl-1 text-xs text-stone-500">
                      {toolLabel(b.name)}
                      {result?.is_error === true && " (hat nicht geklappt)"}
                    </p>
                  );
                return (
                  <ConfirmCard
                    key={j}
                    use={b}
                    shopId={shop.id}
                    decision={decisions[b.id]}
                    result={result}
                    canDecide={busy === null && i === messages.length - 1}
                    onDecide={(d) => decide(b.id, d)}
                  />
                );
              }
              return null;
            })}
          </Fragment>
        ))}
        {busy !== null && (
          <p className="flex items-center gap-2 pl-1 text-sm text-stone-500" role="status">
            <Spinner /> {busy}
          </p>
        )}
        {error !== null && <Alert>{error}</Alert>}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 mt-6 bg-stone-50 pt-2 pb-4">
        <label className="sr-only" htmlFor="assistent-eingabe">
          Nachricht an den Assistenten
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id="assistent-eingabe"
            rows={2}
            className="min-h-0! resize-none"
            maxLength={4000}
            value={text}
            placeholder={
              unavailable ? "Noch nicht eingerichtet" : "Zum Beispiel: Setz den Preis von Sencha auf 9,50 €"
            }
            disabled={unavailable}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <Button type="submit" disabled={unavailable || busy !== null || text.trim() === ""}>
            Senden
          </Button>
        </div>
        {status.data?.available && (
          <p className="mt-1 text-xs text-stone-400">
            Heute {status.data.usedToday} von {status.data.dailyLimit} Antworten genutzt · Die KI kann sich
            irren.
          </p>
        )}
      </form>
    </div>
  );
}

/** Zwei Nachrichten der Person hintereinander werden zu einer. */
export function mergeUserTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out.at(-1);
    if (prev !== undefined && prev.role === "user" && m.role === "user")
      out[out.length - 1] = { role: "user", content: [...prev.content, ...m.content] };
    else out.push(m);
  }
  return out;
}

function Bubble({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed " +
          (mine ? "bg-violet-600 text-white" : "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200")
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Text mit Absätzen und **fett**; alles andere bleibt reiner Text (kein HTML aus dem Modell). */
function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2 whitespace-pre-wrap">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>
          {para
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, j) =>
              part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                <Fragment key={j}>{part}</Fragment>
              ),
            )}
        </p>
      ))}
    </div>
  );
}

function ConfirmCard({
  use,
  shopId,
  decision,
  result,
  canDecide,
  onDecide,
}: {
  use: ToolUse;
  shopId: string;
  decision: Decision | undefined;
  result: Extract<ChatBlock, { type: "tool_result" }> | undefined;
  canDecide: boolean;
  onDecide: (d: Decision) => void;
}) {
  const { title, lines } = describeChange(use.name, use.input);
  const productId = use.name === "update_product" ? String(use.input["productId"] ?? "") : "";
  const orderId = use.name === "mark_order_shipped" ? String(use.input["orderId"] ?? "") : "";
  const product = useQuery({
    queryKey: ["products", shopId, "einzeln", productId],
    queryFn: () => request<Product>(`/admin/v1/products/${encodeURIComponent(productId)}`, { shopId }),
    enabled: productId !== "",
    retry: false,
  });
  const order = useQuery({
    queryKey: ["order", shopId, orderId],
    queryFn: () => request<Order>(`/admin/v1/orders/${encodeURIComponent(orderId)}`, { shopId }),
    enabled: orderId !== "",
    retry: false,
  });
  const subject = product.data?.name ?? (order.data ? `Nr. ${order.data.orderNumber}` : undefined);

  let state: ReactNode;
  if (result !== undefined)
    state =
      result.is_error === true ? (
        <p className="text-sm text-red-700">Hat nicht geklappt: {result.content}</p>
      ) : result.content.startsWith("Abgelehnt") || result.content.startsWith("Nicht ausgeführt") ? (
        <p className="text-sm text-stone-500">Nicht ausgeführt.</p>
      ) : (
        <p className="text-sm font-medium text-emerald-800">Erledigt.</p>
      );
  else if (decision === "approved") state = <p className="text-sm text-stone-500">Wird ausgeführt …</p>;
  else if (decision === "declined") state = <p className="text-sm text-stone-500">Abgelehnt.</p>;
  else
    state = (
      <div className="flex gap-2">
        <Button onClick={() => onDecide("approved")} disabled={!canDecide}>
          Ausführen
        </Button>
        <Button variant="secondary" onClick={() => onDecide("declined")} disabled={!canDecide}>
          Ablehnen
        </Button>
      </div>
    );

  return (
    <div className="ml-0 max-w-[85%] rounded-xl bg-violet-50 p-4 ring-1 ring-violet-200">
      <p className="text-sm font-semibold text-stone-900">
        {title}
        {subject !== undefined && `: ${subject}`}
      </p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-stone-700">
          {lines.map((l) => (
            <li key={l} className="break-words">
              {l}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">{state}</div>
    </div>
  );
}
