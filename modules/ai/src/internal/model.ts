// Austauschbare Schnittstelle zum Sprachmodell (Architektur 3.2, Marktanalyse 4.5). Heute Claude
// über die Messages-API von Anthropic, später auch ein selbst gehostetes offenes Modell möglich.
// Ohne fremdes SDK: ein einziger fetch-Aufruf, damit keine zusätzliche Abhängigkeit nötig ist.
import type { ToolDefinition } from "./tools.js";

export type ChatBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | {
      /** Foto der Händlerin (nur in Nachrichten der Person). */
      readonly type: "image";
      readonly source: {
        readonly type: "base64";
        readonly media_type: "image/jpeg" | "image/png" | "image/webp";
        readonly data: string;
      };
    }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
      readonly is_error?: boolean | undefined;
    };

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly ChatBlock[];
}

export interface ModelRequest {
  readonly system: string;
  readonly tools: readonly ToolDefinition[];
  readonly messages: readonly ChatMessage[];
}

export interface ModelReply {
  /** Nur Text und Werkzeugaufrufe. */
  readonly content: readonly ChatBlock[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AssistantModel {
  /** Name fürs Protokoll und die Anzeige, etwa „claude-sonnet-5-5“. */
  readonly name: string;
  reply(request: ModelRequest): Promise<ModelReply>;
}

/** Modell antwortet nicht oder falsch. Die Ursache bleibt im Protokoll, nie in der Antwort. */
export class ModelUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelUnavailableError";
  }
}

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Standard: https://api.anthropic.com. Auf dem Server der Ausgang über Caddy. */
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function anthropicModel(options: AnthropicOptions): AssistantModel {
  const base = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  return {
    name: options.model,
    async reply(request) {
      let response: Response;
      try {
        response = await doFetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: options.maxTokens ?? 2048,
            system: request.system,
            // Ohne Werkzeuge (etwa für Produkttexte) das Feld weglassen.
            ...(request.tools.length === 0
              ? {}
              : {
                  tools: request.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.inputSchema,
                  })),
                }),
            messages: request.messages,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        });
      } catch (cause) {
        throw new ModelUnavailableError("Sprachmodell nicht erreichbar", { cause });
      }
      if (!response.ok) {
        // Fehlertext von Anthropic nur fürs Protokoll (enthält nie den Schlüssel).
        const text = await response.text().catch(() => "");
        throw new ModelUnavailableError(
          `Sprachmodell antwortet mit ${response.status}: ${text.slice(0, 500)}`,
        );
      }
      const data = (await response.json()) as AnthropicResponse;
      const content: ChatBlock[] = [];
      for (const b of data.content ?? []) {
        if (b.type === "text" && typeof b.text === "string" && b.text !== "")
          content.push({ type: "text", text: b.text });
        else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
          content.push({
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: isRecord(b.input) ? b.input : {},
          });
      }
      return {
        content,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Nachgebildetes Modell für Tests und den lokalen Betrieb ohne Schlüssel: antwortet nach einem
 * festen Drehbuch. Kostet nichts und braucht kein Netz.
 */
export function scriptedModel(script: (request: ModelRequest) => readonly ChatBlock[]): AssistantModel {
  return {
    name: "nachgebildet",
    async reply(request) {
      return { content: script(request), inputTokens: 10, outputTokens: 5 };
    },
  };
}
