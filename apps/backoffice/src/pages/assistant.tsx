// KI-Assistent (Welle 2): Chat mit dem Sprachmodell. Lesende Werkzeuge laufen sofort, ändernde erst
// nach „Ausführen“. Alles läuft über die Admin-API mit der Sitzung des Händlers (lib/assistant.ts).
// Der Verlauf bleibt nur in diesem Browser-Tab (sessionStorage), auf dem Server wird nichts gespeichert.
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { SlopifyMark } from "../components/logo.js";
import { Alert, Button, Spinner, Textarea } from "../components/ui.js";
import { ApiError, request, type Order, type Product } from "../lib/api.js";
import {
  describeChange,
  needsConfirmation,
  prepareForSend,
  runTool,
  shrinkPhoto,
  stripImages,
  toolLabel,
  type AssistantStatus,
  type ChatBlock,
  type ChatMessage,
} from "../lib/assistant.js";
import { useShop } from "./layout.js";

type ToolUse = Extract<ChatBlock, { type: "tool_use" }>;
type Decision = "approved" | "declined";
type ImageBlock = Extract<ChatBlock, { type: "image" }>;

/** Foto, das gleich mitgeschickt wird: klein fürs Modell, groß fürs Produktbild. */
interface Attachment {
  readonly id: string;
  readonly forModel: string;
  readonly preview: Blob;
  readonly forProduct: Blob;
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 20_000_000;
/** Größer als das lädt das Backoffice ein verkleinertes Produktbild hoch (API-Grenze 8 MB). */
const MAX_PRODUCT_PHOTO_BYTES = 7_500_000;

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
    sessionStorage.setItem(storageKey(shopId), JSON.stringify(stripImages(messages)));
  } catch {
    // Kein Speicher (privates Fenster): Der Verlauf hält dann nur, solange die Seite offen ist.
  }
}

function toolUses(m: ChatMessage | undefined): ToolUse[] {
  if (m?.role !== "assistant") return [];
  return m.content.filter((b): b is ToolUse => b.type === "tool_use");
}

interface AssistantApi {
  readonly status: ReturnType<typeof useQuery<AssistantStatus>>;
  readonly messages: readonly ChatMessage[];
  readonly decisions: Readonly<Record<string, Decision>>;
  readonly busy: string | null;
  readonly error: string | null;
  readonly text: string;
  readonly setText: (t: string) => void;
  readonly attachment: Attachment | null;
  readonly setAttachment: (a: Attachment | null) => void;
  readonly attachError: string | null;
  readonly attach: (file: File | undefined) => Promise<void>;
  readonly send: (value: string) => void;
  readonly decide: (id: string, d: Decision) => void;
  readonly reset: () => void;
  /** Seitenleiste offen? */
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

const AssistantContext = createContext<AssistantApi | null>(null);

export function useAssistant(): AssistantApi {
  const a = useContext(AssistantContext);
  if (a === null) throw new Error("useAssistant außerhalb von AssistantProvider");
  return a;
}

/**
 * Hält den Chat für den ganzen Shop: Er bleibt beim Seitenwechsel erhalten und ist auf der Seite
 * „Assistent“ und in der Seitenleiste derselbe.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const shop = useShop();
  const location = useLocation();
  const [open, setOpen] = useState(false);
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
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const photosRef = useRef(new Map<string, Blob>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    saveHistory(shop.id, messages);
  }, [shop.id, messages]);

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
              const r = await runTool(u.name, u.input, shop.id, photosRef.current);
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
            body: { messages: prepareForSend(current) },
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

  const attach = async (file: File | undefined) => {
    setAttachError(null);
    if (file === undefined) return;
    if (!PHOTO_TYPES.has(file.type)) return setAttachError("Bitte ein Foto als JPEG, PNG oder WebP.");
    if (file.size > MAX_PHOTO_BYTES) return setAttachError("Das Foto ist zu groß (höchstens 20 MB).");
    try {
      const small = await shrinkPhoto(file);
      const forProduct = file.size <= MAX_PRODUCT_PHOTO_BYTES ? file : (await shrinkPhoto(file, 2400)).blob;
      const used = [...photosRef.current.keys()].map((k) => Number(k.slice(5)));
      const id = `foto-${Math.max(0, ...used, ...photoNumbers(messagesRef.current)) + 1}`;
      setAttachment({ id, forModel: small.data, preview: small.blob, forProduct });
    } catch {
      setAttachError("Das Foto ließ sich nicht öffnen.");
    }
  };

  const send = (value: string) => {
    const t = value.trim();
    if ((t === "" && attachment === null) || busy !== null) return;
    setText("");
    const photo = attachment;
    setAttachment(null);
    if (photo !== null) photosRef.current.set(photo.id, photo.forProduct);
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
    const note = pageNote(location.pathname, shop.id, queryClient);
    const prefix = note === undefined ? "" : `[Seite: ${note}] `;
    const content: ChatBlock[] =
      photo === null
        ? [{ type: "text", text: `${prefix}${t}` }]
        : [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.forModel } },
            { type: "text", text: `[Foto ${photo.id}] ${prefix}${t || "Bitte leg das als Produkt an."}` },
          ];
    const next: ChatMessage[] = [...base, { role: "user", content }];
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
    photosRef.current.clear();
    setAttachment(null);
    setDecisions({});
    setError(null);
  };

  const api: AssistantApi = {
    status,
    messages,
    decisions,
    busy,
    error,
    text,
    setText,
    attachment,
    setAttachment,
    attachError,
    attach,
    send,
    decide,
    reset,
    open,
    setOpen,
  };
  return <AssistantContext.Provider value={api}>{children}</AssistantContext.Provider>;
}

/** Was die Person gerade sieht, als kurzer Hinweis für das Modell (ohne Kundendaten). */
export function pageNote(pathname: string, shopId: string, queryClient: QueryClient): string | undefined {
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const [section, id] = parts;
  if (section === "produkte" && id === "neu") return "Formular „Neues Produkt“";
  if (section === "produkte" && id !== undefined) {
    const p = queryClient.getQueryData<Product>(["product", shopId, id]);
    return p === undefined ? `Produkt mit ID ${id}` : `Produkt „${p.name}“ (ID ${id})`;
  }
  if (section === "produkte") return "Produktliste";
  if (section === "bestellungen" && id !== undefined) {
    const o = queryClient.getQueryData<Order>(["order", shopId, id]);
    return o === undefined ? `Bestellung mit ID ${id}` : `Bestellung Nr. ${o.orderNumber} (ID ${id})`;
  }
  if (section === "bestellungen") return "Bestellliste";
  if (section === "kategorien") return "Kategorien";
  if (section === "aussehen") return "Aussehen des Shops";
  if (section === "uebersicht") return "Übersicht";
  return undefined;
}

/** Hinweise vor dem Text („[Foto foto-1] [Seite: …] “) nicht anzeigen. */
export function visibleText(text: string): string {
  return text.replace(/^(\[(Foto foto-\d+|Seite: [^\]]*)\] )+/, "");
}

export function AssistantPage() {
  return <AssistantChat variant="page" />;
}

/** Der Chat selbst: als eigene Seite oder schmal in der Seitenleiste. */
export function AssistantChat({ variant }: { variant: "page" | "panel" }) {
  const shop = useShop();
  const {
    status,
    messages,
    decisions,
    busy,
    error,
    text,
    setText,
    attachment,
    setAttachment,
    attachError,
    attach,
    send,
    decide,
    reset,
    setOpen,
  } = useAssistant();
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Neuere Browser geben hier ein Promise zurück; ein Effekt darf nur eine Aufräumfunktion liefern.
    void endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages, busy]);
  const panel = variant === "panel";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const results = new Map<string, Extract<ChatBlock, { type: "tool_result" }>>();
  for (const m of messages)
    for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);

  const unavailable = status.data !== undefined && !status.data.available;

  return (
    <div className={panel ? "flex h-full flex-col" : "mx-auto flex max-w-3xl flex-col"}>
      {panel ? (
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <SlopifyMark className="size-5" /> Assistent
          </h2>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button variant="ghost" className="px-2 py-1" onClick={reset} disabled={busy !== null}>
                Neuer Chat
              </Button>
            )}
            <Button
              variant="ghost"
              className="px-2 py-1"
              aria-label="Assistent schließen"
              onClick={() => setOpen(false)}
            >
              Schließen
            </Button>
          </div>
        </div>
      ) : (
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
      )}

      {unavailable && (
        <Alert tone="info">
          Der Assistent ist auf diesem Server noch nicht eingerichtet. Es fehlt der Zugang zum Sprachmodell.
        </Alert>
      )}

      <div className={panel ? "flex-1 space-y-4 overflow-y-auto px-4 py-4" : "space-y-4"} aria-live="polite">
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
            <p className="mt-4 text-sm text-stone-500">
              Tipp: Schick ein Foto von einem Produkt, ich schlage Name, Text und Preis vor und lege es an.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <Fragment key={i}>
            {m.content.map((b, j) => {
              if (b.type === "text")
                return (
                  <Bubble key={j} mine={m.role === "user"}>
                    <RichText text={m.role === "user" ? visibleText(b.text) : b.text} />
                  </Bubble>
                );
              if (b.type === "image")
                return (
                  <div key={j} className="flex justify-end">
                    <PhotoThumb
                      block={b}
                      className="max-h-48 max-w-[60%] rounded-2xl ring-1 ring-stone-200"
                    />
                  </div>
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

      <form
        onSubmit={onSubmit}
        className={
          panel
            ? "border-t border-stone-200 bg-stone-50 px-4 pt-2 pb-3"
            : "sticky bottom-0 mt-6 bg-stone-50 pt-2 pb-4"
        }
      >
        <label className="sr-only" htmlFor={`assistent-eingabe-${variant}`}>
          Nachricht an den Assistenten
        </label>
        {attachment !== null && (
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-stone-200">
            <BlobImage
              blob={attachment.preview}
              className="size-12 rounded-md object-cover"
              alt="Foto zum Mitschicken"
            />
            <span className="flex-1 text-sm text-stone-600">Foto wird mitgeschickt</span>
            <Button variant="ghost" onClick={() => setAttachment(null)}>
              Entfernen
            </Button>
          </div>
        )}
        {attachError !== null && (
          <div className="mb-2">
            <Alert>{attachError}</Alert>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void attach(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            aria-label="Foto anhängen"
            title="Foto anhängen"
            disabled={unavailable || busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            Foto
          </Button>
          <Textarea
            id={`assistent-eingabe-${variant}`}
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
          <Button
            type="submit"
            disabled={unavailable || busy !== null || (text.trim() === "" && attachment === null)}
          >
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

/** Nummern der Fotos, die im Verlauf schon vorkommen („[Foto foto-3]“). */
function photoNumbers(messages: readonly ChatMessage[]): number[] {
  return messages.flatMap((m) =>
    m.content.flatMap((b) =>
      b.type === "text" ? [...b.text.matchAll(/\[Foto foto-(\d+)\]/g)].map((x) => Number(x[1])) : [],
    ),
  );
}

/** Zeigt ein Bild aus dem Speicher des Browsers (blob:), denn die Sicherheitsregeln erlauben kein data:. */
function BlobImage({ blob, className, alt }: { blob: Blob; className?: string | undefined; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url === null ? null : <img src={url} alt={alt} className={className} />;
}

function PhotoThumb({ block, className }: { block: ImageBlock; className?: string }) {
  const [blob] = useState(() => {
    const bytes = Uint8Array.from(atob(block.source.data), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: block.source.media_type });
  });
  return <BlobImage blob={blob} className={className} alt="Geschicktes Foto" />;
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
