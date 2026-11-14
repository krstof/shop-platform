// EINZIGE öffentliche Datei des Moduls ai (Architektur 3.3, Regel 3).
// KI-Assistent für Händler (Welle 2): Chat mit einem Sprachmodell über eine austauschbare
// Schnittstelle; die Werkzeuge führt das Backoffice über die Admin-API aus.
import type { Endpoint } from "@shop/http";
import type { Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { assistantEndpoints } from "./http/assistant.js";
import type { AssistantModel } from "./internal/model.js";
import { usageRepository } from "./internal/usage.js";

export {
  anthropicModel,
  scriptedModel,
  ModelUnavailableError,
  type AnthropicOptions,
  type AssistantModel,
  type ChatBlock,
  type ChatMessage,
  type ModelRequest,
} from "./internal/model.js";
export { SYSTEM_PROMPT, TOOLS, type ToolDefinition } from "./internal/tools.js";

/** Standard-Tageslimit je Shop (Antworten des Modells). */
export const DEFAULT_DAILY_LIMIT = 300;

export interface AiDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  /** Ohne Modell meldet der Assistent „nicht eingerichtet“. */
  readonly model?: AssistantModel | undefined;
  readonly dailyLimit?: number | undefined;
  readonly onModelError?: ((error: unknown) => void) | undefined;
}

export function aiEndpoints(deps: AiDependencies): Endpoint[] {
  return assistantEndpoints({
    model: deps.model,
    usage: usageRepository(deps.database as Database<DB>),
    dailyLimit: deps.dailyLimit ?? DEFAULT_DAILY_LIMIT,
    onModelError: deps.onModelError,
  });
}
