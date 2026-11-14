// KI-Assistent für Händler (Welle 2): Zustand lesen und eine Runde im Chat.
// Der Server ist nur der Übergang zum Sprachmodell: Anweisungen und Werkzeuge stehen fest hier,
// ausgeführt werden die Werkzeuge im Backoffice über die normale Admin-API (siehe tools.ts).
import { defineEndpoint, type Endpoint } from "@shop/http";
import { RateLimitedError, ServiceUnavailableError } from "@shop/kernel";
import { z } from "zod";
import type { AssistantModel, ChatBlock, ChatMessage } from "../internal/model.js";
import { SYSTEM_PROMPT, TOOLS } from "../internal/tools.js";
import type { UsageRepository } from "../internal/usage.js";

const toolName = z.enum(TOOLS.map((t) => t.name) as [string, ...string[]]);
const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

const textBlock = z.strictObject({ type: z.literal("text"), text: z.string().min(1).max(8000) });
const toolUseBlock = z.strictObject({
  type: z.literal("tool_use"),
  id: blockId,
  name: toolName,
  input: z.record(z.string(), z.unknown()),
});
// Fotos: das Backoffice verkleinert sie vorher (lange Kante 1024 px), die ganze Anfrage bleibt unter 1 MB.
const imageBlock = z.strictObject({
  type: z.literal("image"),
  source: z.strictObject({
    type: z.literal("base64"),
    media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z
      .string()
      .min(16)
      .max(700_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "ist kein Base64"),
  }),
});
const MAX_IMAGES = 2;

const toolResultBlock = z.strictObject({
  type: z.literal("tool_result"),
  tool_use_id: blockId,
  content: z.string().max(30_000),
  is_error: z.boolean().optional(),
});

const messageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z
    .array(z.discriminatedUnion("type", [textBlock, imageBlock, toolUseBlock, toolResultBlock]))
    .min(1)
    .max(20),
});

const chatBody = z
  .strictObject({
    messages: z
      .array(messageSchema)
      .min(1)
      .max(80)
      .meta({ description: "Bisheriger Verlauf, älteste zuerst." }),
  })
  .refine((b) => b.messages[0]?.role === "user" && b.messages.at(-1)?.role === "user", {
    message: "Der Verlauf beginnt und endet mit einer Nachricht der Händlerin oder des Händlers.",
    path: ["messages"],
  })
  .refine((b) => b.messages.every((m) => m.role === "user" || m.content.every((c) => c.type !== "image")), {
    message: "Fotos gibt es nur in Nachrichten der Händlerin oder des Händlers.",
    path: ["messages"],
  })
  .refine(
    (b) => b.messages.flatMap((m) => m.content).filter((c) => c.type === "image").length <= MAX_IMAGES,
    {
      message: `Höchstens ${MAX_IMAGES} Fotos je Anfrage.`,
      path: ["messages"],
    },
  );

const replySchema = z
  .object({
    content: z.array(z.discriminatedUnion("type", [textBlock.loose(), toolUseBlock.loose()])),
  })
  .meta({ id: "AssistantReply", description: "Antwort des Assistenten: Text und Werkzeugaufrufe." });

const statusSchema = z
  .object({
    available: z.boolean().meta({ description: "Ist ein Sprachmodell eingerichtet?" }),
    model: z.string().nullable(),
    dailyLimit: z.number().int(),
    usedToday: z.number().int(),
    tools: z.array(z.object({ name: z.string(), changes: z.boolean() })),
  })
  .meta({ id: "AssistantStatus", description: "Zustand des Assistenten für diesen Shop." });

export interface AssistantDeps {
  readonly model: AssistantModel | undefined;
  readonly usage: UsageRepository;
  readonly dailyLimit: number;
  readonly onModelError?: ((error: unknown) => void) | undefined;
}

export function assistantEndpoints(deps: AssistantDeps): Endpoint[] {
  const status = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/assistant",
    operationId: "getAssistant",
    summary: "Assistent: Zustand",
    description:
      "Ob der KI-Assistent eingerichtet ist, das Tageslimit des Shops und die Werkzeuge; `changes: true` " +
      "heißt, das Backoffice fragt vor dem Ausführen nach.",
    tags: ["Assistent"],
    access: { scopes: ["products:read"] },
    response: { status: 200, description: "Zustand.", schema: statusSchema },
    handler: async () => ({
      available: deps.model !== undefined,
      model: deps.model?.name ?? null,
      dailyLimit: deps.dailyLimit,
      usedToday: await deps.usage.requestsToday(),
      tools: TOOLS.map((t) => ({ name: t.name, changes: t.changes })),
    }),
  });

  const chat = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/assistant/chat",
    operationId: "chatWithAssistant",
    summary: "Assistent: eine Runde im Chat",
    description:
      "Schickt den bisherigen Verlauf an das Sprachmodell und liefert dessen Antwort: Text und " +
      "Werkzeugaufrufe. Der Server führt keine Werkzeuge aus; das macht das Backoffice über die Admin-API " +
      "und schickt das Ergebnis als `tool_result` in der nächsten Runde mit. Je Shop gilt ein Tageslimit (429).",
    tags: ["Assistent"],
    access: { scopes: ["products:read"] },
    idempotency: "none",
    body: chatBody,
    bodyExample: {
      messages: [
        { role: "user", content: [{ type: "text", text: "Welche Bestellungen muss ich versenden?" }] },
      ],
    },
    response: { status: 200, description: "Antwort des Assistenten.", schema: replySchema },
    problems: [429],
    handler: async ({ body }) => {
      const model = deps.model;
      if (model === undefined)
        throw new ServiceUnavailableError({
          detail: "Der Assistent ist auf diesem Server nicht eingerichtet.",
        });
      if ((await deps.usage.requestsToday()) >= deps.dailyLimit)
        throw new RateLimitedError({
          detail: `Der Assistent hat heute schon ${deps.dailyLimit} Antworten für diesen Shop gegeben. Morgen geht es weiter.`,
        });
      let reply;
      try {
        reply = await model.reply({
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: body.messages as readonly ChatMessage[],
        });
      } catch (error) {
        deps.onModelError?.(error);
        throw new ServiceUnavailableError({
          detail: "Der Assistent konnte gerade nicht antworten. Bitte gleich noch einmal versuchen.",
          cause: error,
        });
      }
      await deps.usage.record(reply.inputTokens, reply.outputTokens);
      const content = reply.content.filter(
        (b): b is Extract<ChatBlock, { type: "text" | "tool_use" }> =>
          b.type === "text" || (b.type === "tool_use" && TOOLS.some((t) => t.name === b.name)),
      );
      if (content.length === 0) return { content: [{ type: "text" as const, text: "…" }] };
      return { content };
    },
  });

  return [status, chat];
}
