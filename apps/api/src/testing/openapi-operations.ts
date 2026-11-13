// Liest die eingecheckten OpenAPI-Dateien und baut daraus Anfragen für die Test-Generatoren
// T-08 und T-09 (Sicherheit Kapitel 7). Die Dateien sind durch `pnpm openapi --check` aktuell.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface Operation {
  readonly api: string;
  readonly method: string;
  readonly path: string;
  readonly operationId: string;
  readonly scopes: readonly string[];
  readonly isPublic: boolean;
  readonly pathParams: readonly string[];
  readonly headerParams: readonly { name: string; required: boolean }[];
  readonly bodyExample: unknown;
  readonly hasBody: boolean;
  /** Antwort 200 ist eine Seite einer Liste (`data` und `page`). */
  readonly isPage: boolean;
}

interface RawOp {
  operationId: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { content: Record<string, { example?: unknown }> };
  "x-required-scopes"?: string[];
  "x-public"?: boolean;
  responses?: Record<
    string,
    { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> }
  >;
}

export function loadOperations(
  apis: readonly string[] = ["admin", "store", "platform", "auth"],
): Operation[] {
  const ops: Operation[] = [];
  for (const api of apis) {
    const doc = JSON.parse(readFileSync(join(repoRoot, "openapi", `${api}.json`), "utf8")) as {
      paths: Record<string, Record<string, RawOp>>;
    };
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const params = op.parameters ?? [];
        ops.push({
          api,
          method: method.toUpperCase(),
          path,
          operationId: op.operationId,
          scopes: op["x-required-scopes"] ?? [],
          isPublic: op["x-public"] === true,
          pathParams: params.filter((p) => p.in === "path").map((p) => p.name),
          headerParams: params
            .filter((p) => p.in === "header")
            .map((p) => ({ name: p.name, required: p.required === true })),
          bodyExample: op.requestBody?.content["application/json"]?.example,
          hasBody: op.requestBody !== undefined,
          isPage:
            op.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.["page"] !== undefined,
        });
      }
    }
  }
  return ops;
}

/**
 * Baut eine gültige Anfrage für eine Operation: Pfadwerte aus `ids` (sonst zufällige UUIDs),
 * Beispiel-Inhalt aus OpenAPI, Pflicht-Kopfzeilen (If-Match "1", frischer Idempotency-Key).
 */
export function buildRequest(
  op: Operation,
  ids: Readonly<Record<string, string>> = {},
): { method: string; url: string; headers: Record<string, string>; payload?: string } {
  const url = op.path.replace(/\{([a-zA-Z0-9]+)\}/g, (_m, name: string) => ids[name] ?? randomUUID());
  const headers: Record<string, string> = {};
  for (const h of op.headerParams) {
    if (h.name === "If-Match") headers["if-match"] = '"1"';
    if (h.name === "Idempotency-Key" && h.required) headers["idempotency-key"] = `t-${randomUUID()}`;
  }
  if (op.hasBody) {
    headers["content-type"] = "application/json";
    return { method: op.method, url, headers, payload: JSON.stringify(op.bodyExample) };
  }
  return { method: op.method, url, headers };
}
