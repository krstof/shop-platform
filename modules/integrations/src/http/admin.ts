// Seite „Einstellungen → Anbindungen“ (21.11.2026): lesen, speichern, Verbindung prüfen.
//
// Die Oberfläche kennt keine einzelne Anbindung: Sie baut sich aus dem Katalog (catalog.ts), den
// diese Endpunkte mitliefern. Eine neue Anbindung braucht deshalb nur einen Eintrag im Katalog und
// eine Prüffunktion, nicht eine neue Seite.
//
// Geheime Felder gehen nur hinein. Zurück kommt je Feld nur `filled`, also ob etwas hinterlegt ist.
import { defineEndpoint, singleLineText, type Endpoint } from "@shop/http";
import { NotFoundError, ValidationError, type Database, type SecretBox } from "@shop/kernel";
import { z } from "zod";
import { findIntegration, INTEGRATIONS } from "../catalog.js";
import { runCheck } from "../internal/checks.js";
import { createIntegrations, type IntegrationState } from "../internal/store.js";

export interface IntegrationDependencies {
  readonly database: Database<unknown>;
  readonly secretBox: SecretBox;
}

const fieldSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    hint: z.string(),
    secret: z.boolean().meta({ description: "Geheim: wird verschlüsselt gespeichert, nie zurückgegeben." }),
    required: z.boolean(),
    maxLength: z.number().int(),
    filled: z.boolean().meta({ description: "Ist ein Wert hinterlegt?" }),
    value: z.string().meta({ description: "Nur bei offenen Feldern gefüllt, bei geheimen immer leer." }),
  })
  .meta({ id: "IntegrationField", description: "Ein Feld einer Anbindung." });

const integrationSchema = z
  .object({
    provider: z.string(),
    name: z.string(),
    description: z.string(),
    where: z.string(),
    setup: z
      .string()
      .meta({ description: "Was der Händler selbst besorgen muss; leer, wenn nichts nötig ist." }),
    helpUrl: z.string(),
    testable: z.boolean(),
    shopUrlPath: z.string().meta({
      description: "Pfad im Shop, aus dem das Backoffice eine Adresse zum Kopieren baut; leer, wenn keiner.",
    }),
    enabled: z.boolean(),
    fields: z.array(fieldSchema),
    checkedAt: z.string().nullable().meta({ description: "Zeitpunkt der letzten Verbindungsprüfung." }),
    checkOk: z.boolean().nullable(),
    checkMessage: z.string().nullable(),
  })
  .meta({ id: "Integration", description: "Eine Anbindung mit Katalogangaben und Stand im Shop." });

const listSchema = z
  .object({ data: z.array(integrationSchema) })
  .meta({ id: "IntegrationList", description: "Alle Anbindungen, die es gibt." });

// Der Name des Dienstes steht im Rumpf, nicht im Pfad: Er gehört zum Katalog und nicht zu einem
// Shop. Im Pfad wäre er eine Kennung, die jedem Shop gehört, und der Isolationstest T-08 verlangt
// zu Recht, dass jede Kennung im Pfad einem Shop gehört und für fremde Shops 404 ergibt.
const saveInput = z.strictObject({
  provider: singleLineText(40),
  enabled: z.boolean(),
  /** Nur Felder aus dem Katalog; geheime Felder dürfen fehlen, dann bleibt der alte Wert. */
  values: z.record(z.string(), singleLineText(500)),
});

const testInput = z.strictObject({ provider: singleLineText(40) });

function view(definitionProvider: string, state: IntegrationState | undefined) {
  const definition = findIntegration(definitionProvider);
  if (definition === undefined) throw new NotFoundError({ detail: "Diese Anbindung gibt es nicht." });
  return {
    provider: definition.provider,
    name: definition.name,
    description: definition.description,
    where: definition.where,
    setup: definition.setup ?? "",
    helpUrl: definition.helpUrl ?? "",
    testable: definition.testable,
    shopUrlPath: definition.shopUrlPath ?? "",
    enabled: state?.enabled ?? definition.defaultEnabled === true,
    fields: definition.fields.map((f) => {
      const stored = f.secret ? (state?.secrets[f.key] ?? "") : (state?.settings[f.key] ?? "");
      return {
        key: f.key,
        label: f.label,
        hint: f.hint ?? "",
        secret: f.secret,
        required: f.required,
        maxLength: f.maxLength,
        filled: stored !== "",
        value: f.secret ? "" : stored,
      };
    }),
    checkedAt: state?.checkedAt?.toISOString() ?? null,
    checkOk: state?.checkOk ?? null,
    checkMessage: state?.checkMessage ?? null,
  };
}

export function integrationEndpoints(deps: IntegrationDependencies): Endpoint[] {
  const integrations = createIntegrations(deps);

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/integrations",
    operationId: "listIntegrations",
    summary: "Anbindungen auflisten",
    description:
      "Alle Anbindungen, die es gibt, mit Erklärung, nötigen Feldern und dem Stand im eigenen Shop. " +
      "Geheime Felder kommen nie mit Wert zurück, sondern nur mit „hinterlegt“.",
    tags: ["Einstellungen"],
    access: { scopes: ["settings:read"] },
    response: { status: 200, description: "Alle Anbindungen.", schema: listSchema },
    handler: async () => {
      const states = new Map((await integrations.list()).map((s) => [s.provider, s]));
      return { data: INTEGRATIONS.map((d) => view(d.provider, states.get(d.provider))) };
    },
  });

  const save = defineEndpoint({
    api: "admin",
    method: "PUT",
    path: "/integrations",
    operationId: "saveIntegration",
    summary: "Anbindung speichern",
    description:
      "Schaltet eine Anbindung ein oder aus und speichert ihre Felder. Ein geheimes Feld, das nicht " +
      "mitkommt, behält seinen bisherigen Wert; ein leerer Wert löscht ihn.",
    tags: ["Einstellungen"],
    access: { scopes: ["settings:write"] },
    body: saveInput,
    bodyExample: { provider: "telegram", enabled: true, values: { botToken: "123456789:AA…" } },
    response: { status: 200, description: "Die gespeicherte Anbindung.", schema: integrationSchema },
    problems: [404],
    handler: async ({ body }) => {
      const definition = findIntegration(body.provider);
      if (definition === undefined) throw new NotFoundError({ detail: "Diese Anbindung gibt es nicht." });
      const settings: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const [key, value] of Object.entries(body.values)) {
        const field = definition.fields.find((f) => f.key === key);
        if (field === undefined)
          throw new ValidationError({ detail: `Das Feld „${key}“ gibt es hier nicht.` });
        if (value.length > field.maxLength)
          throw new ValidationError({
            detail: `„${field.label}“ ist zu lang (höchstens ${field.maxLength} Zeichen).`,
          });
        if (field.secret) secrets[key] = value;
        else settings[key] = value;
      }
      const before = await integrations.get(body.provider);
      // Offene Felder, die nicht mitkamen, behalten ihren Wert (etwa die Chat-Nummer bei Telegram).
      const mergedSettings = { ...before?.settings, ...settings };
      if (body.enabled)
        for (const field of definition.fields) {
          if (!field.required) continue;
          const filled = field.secret
            ? (secrets[field.key] ?? before?.secrets[field.key] ?? "") !== ""
            : (mergedSettings[field.key] ?? "") !== "";
          if (!filled)
            throw new ValidationError({ detail: `„${field.label}“ fehlt. Ohne das geht es nicht.` });
        }
      const state = await integrations.save({
        provider: body.provider,
        enabled: body.enabled,
        settings: mergedSettings,
        secrets,
      });
      return view(body.provider, state);
    },
  });

  const test = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/integrations/test",
    operationId: "testIntegration",
    summary: "Verbindung prüfen",
    description:
      "Ruft den fremden Dienst einmal auf und sagt, ob es geklappt hat. Bei Telegram holt die " +
      "Prüfung außerdem die Chat-Nummer, sobald du deinem Bot einmal geschrieben hast.",
    tags: ["Einstellungen"],
    access: { scopes: ["settings:write"] },
    body: testInput,
    bodyExample: { provider: "telegram" },
    response: {
      status: 200,
      description: "Ergebnis der Prüfung.",
      schema: z
        .object({ ok: z.boolean(), message: z.string() })
        .meta({ id: "IntegrationCheck", description: "Ergebnis einer Verbindungsprüfung." }),
    },
    problems: [404],
    handler: async ({ body }) => {
      const definition = findIntegration(body.provider);
      if (definition === undefined) throw new NotFoundError({ detail: "Diese Anbindung gibt es nicht." });
      const state = await integrations.get(body.provider);
      if (state === undefined) return { ok: false, message: "Noch nichts hinterlegt." };
      const result = await runCheck(definition.provider, state);
      if (result.settings !== undefined)
        await integrations.save({
          provider: body.provider,
          enabled: state.enabled,
          settings: { ...state.settings, ...result.settings },
          secrets: {},
        });
      await integrations.recordCheck(body.provider, result.ok, result.message);
      return { ok: result.ok, message: result.message };
    },
  });

  return [list, save, test];
}
