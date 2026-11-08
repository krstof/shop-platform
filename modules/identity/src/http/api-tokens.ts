// API-Token in der Admin-API (E6 Teil 5, Sicherheit 5.2 und 5.3, SIC-03, API-01).
// Anlegen, auflisten und widerrufen. Nur die Inhaberin (api_tokens:*), nur mit Sitzung; Anlegen
// zusätzlich nur, wenn das Passwort vor höchstens 15 Minuten eingegeben wurde.
import {
  decodeCursor,
  defineEndpoint,
  idParam,
  listQuery,
  pageOf,
  singleLineText,
  timestamp,
  toPage,
  type Endpoint,
} from "@shop/http";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
  ValidationError,
  type Locale,
} from "@shop/kernel";
import { z } from "zod";
import {
  MAX_ACTIVE_TOKENS_PER_SHOP,
  type ApiTokenRecord,
  type ApiTokenService,
} from "../internal/api-tokens.js";
import { TOKEN_SCOPES } from "../internal/roles.js";
import { REAUTHENTICATION_SECONDS } from "../internal/session-rules.js";

export interface ApiTokenEndpointOptions {
  readonly tokens: ApiTokenService;
  /** Nur für Tests. */
  readonly now?: () => number;
}

const apiTokenSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    prefix: z
      .string()
      .describe(
        "Anfang des Tokens zum Wiedererkennen, etwa shp_at_3f9a. Das ganze Token zeigt nur die Antwort beim Anlegen.",
      ),
    scopes: z.array(z.enum(TOKEN_SCOPES as [string, ...string[]])),
    status: z
      .enum(["active", "expired", "revoked"])
      .describe("active: gültig. expired: Ablaufdatum erreicht. revoked: widerrufen."),
    issuedForUserId: z
      .uuid()
      .nullable()
      .describe("Konto, in dessen Namen das Token gilt. Es darf nie mehr, als dieses Konto im Shop darf."),
    expiresAt: timestamp.nullable(),
    lastUsedAt: timestamp.nullable().describe("Letzte Benutzung, auf eine Minute genau."),
    revokedAt: timestamp.nullable(),
    createdAt: timestamp,
  })
  .meta({ id: "ApiToken", description: "API-Token eines Shops (ohne das Token selbst)." });

const createdApiTokenSchema = apiTokenSchema
  .extend({
    token: z
      .string()
      .describe(
        "Das Token. Wird nur in dieser Antwort gezeigt und ist danach nicht mehr abrufbar. " +
          "Benutzen als Kopfzeile Authorization: Bearer <token>.",
      ),
  })
  .meta({ id: "CreatedApiToken" });

const createInput = z.strictObject({
  name: singleLineText(100).describe("Wofür das Token ist, etwa „Lagerabgleich“."),
  scopes: z
    .array(z.enum(TOKEN_SCOPES as [string, ...string[]]))
    .min(1)
    .max(TOKEN_SCOPES.length)
    .refine((v) => new Set(v).size === v.length, "Jede Berechtigung nur einmal.")
    .describe("Berechtigungen des Tokens. Höchstens die eigenen; API-Token verwalten kann ein Token nie."),
  expiresAt: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Optionales Ablaufdatum, mindestens eine Minute in der Zukunft."),
});

function iso(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

function toApiToken(r: ApiTokenRecord) {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: [...r.scopes],
    status: r.status,
    issuedForUserId: r.issuedForUserId,
    expiresAt: iso(r.expiresAt),
    lastUsedAt: iso(r.lastUsedAt),
    revokedAt: iso(r.revokedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

const TEXTS = {
  scope: {
    de: "Diese Berechtigung kann das Token nicht bekommen.",
    en: "The token cannot be given this permission.",
  },
  expiry: {
    de: "Das Ablaufdatum muss mindestens eine Minute in der Zukunft liegen.",
    en: "The expiry date must be at least one minute in the future.",
  },
  tooMany: {
    de: `Höchstens ${MAX_ACTIVE_TOKENS_PER_SHOP} gültige Token je Shop. Bitte zuerst ein altes widerrufen.`,
    en: `At most ${MAX_ACTIVE_TOKENS_PER_SHOP} valid tokens per shop. Please revoke an old one first.`,
  },
  sessionOnly: {
    de: "API-Token lassen sich nur mit einer Anmeldung im Backoffice anlegen, nicht mit einem Token.",
    en: "API tokens can only be created when signed in, not with a token.",
  },
} as const satisfies Record<string, Record<Locale, string>>;

const cursorKey = z.strictObject({ id: z.uuid() });

export function apiTokenEndpoints(options: ApiTokenEndpointOptions): Endpoint[] {
  const { tokens } = options;
  const now = options.now ?? Date.now;
  const tenantOf = (tenantId: string | undefined): string => {
    // Der Router lässt Admin-Anfragen ohne Shop gar nicht durch; fehlt er, ist das ein Programmfehler.
    if (tenantId === undefined) throw new Error("Admin-Endpunkt ohne Shop");
    return tenantId;
  };

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/api-tokens",
    operationId: "listApiTokens",
    summary: "API-Token auflisten",
    description:
      "Listet alle API-Token des Shops, neueste zuerst, auch abgelaufene und widerrufene. " +
      "Das Token selbst steht nie darin, nur sein Anfang zum Wiedererkennen.",
    tags: ["API-Token"],
    access: { scopes: ["api_tokens:read"] },
    query: listQuery(),
    response: { status: 200, description: "Eine Seite mit API-Token.", schema: pageOf(apiTokenSchema) },
    handler: async ({ query, auth, locale }) => {
      const before =
        query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const rows = await tokens.list(tenantOf(auth?.tenantId), {
        limit: query.limit,
        ...(before === undefined ? {} : { beforeId: before }),
      });
      return toPage(rows, query.limit, (r) => ({ id: r.id }), toApiToken);
    },
  });

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/api-tokens",
    operationId: "createApiToken",
    summary: "API-Token anlegen",
    description:
      "Legt ein API-Token für Skripte an. Es gilt nur für diesen Shop, im Namen des eigenen Kontos und " +
      "höchstens mit dessen Rechten. Das Token steht nur in dieser Antwort. Verlangt eine Anmeldung " +
      "(kein Token) und eine Passworteingabe vor höchstens 15 Minuten; sonst 403 " +
      "reauthentication_required, dann das Passwort an POST /auth/v1/confirm-password schicken und " +
      "wiederholen. Ohne Idempotency-Key, weil ein Speicher für Wiederholungen das Token enthalten würde.",
    tags: ["API-Token"],
    access: { scopes: ["api_tokens:write"] },
    body: createInput,
    bodyExample: { name: "Lagerabgleich", scopes: ["products:read", "products:write"] },
    idempotency: "none",
    response: {
      status: 201,
      description: "Das neue Token, einmalig mit Klartext.",
      schema: createdApiTokenSchema,
    },
    problems: [409],
    handler: async ({ body, auth, locale }) => {
      if (auth?.actor.type !== "user" || auth.actor.id === undefined)
        throw new ForbiddenError({ detail: TEXTS.sessionOnly[locale] });
      const confirmed = auth.passwordConfirmedAt;
      if (confirmed === undefined || now() - confirmed.getTime() > REAUTHENTICATION_SECONDS * 1000)
        throw new ReauthenticationRequiredError();
      const result = await tokens.create({
        tenantId: tenantOf(auth.tenantId),
        userId: auth.actor.id,
        name: body.name,
        scopes: body.scopes as (typeof TOKEN_SCOPES)[number][],
        expiresAt: body.expiresAt === undefined ? undefined : new Date(body.expiresAt),
      });
      if (!result.ok) {
        if (result.reason === "too_many_tokens") throw new ConflictError({ detail: TEXTS.tooMany[locale] });
        if (result.reason === "expiry_in_past")
          throw new ValidationError({
            errors: [{ path: "/body/expiresAt", code: "expiry_in_past", message: TEXTS.expiry[locale] }],
          });
        const rejected: readonly string[] = result.reason === "scope_not_allowed" ? result.scopes : [];
        throw new ValidationError({
          errors: rejected.map((s) => ({
            path: `/body/scopes/${body.scopes.indexOf(s)}`,
            code: "scope_not_allowed",
            message: TEXTS.scope[locale],
          })),
        });
      }
      return { ...toApiToken(result.record), token: result.token };
    },
  });

  const revoke = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/api-tokens/{apiTokenId}",
    operationId: "revokeApiToken",
    summary: "API-Token widerrufen",
    description:
      "Widerruft ein Token sofort und endgültig. Es bleibt in der Liste (Status revoked), damit " +
      "nachvollziehbar ist, wofür es da war. Ein schon widerrufenes Token bleibt unverändert.",
    tags: ["API-Token"],
    access: { scopes: ["api_tokens:write"] },
    params: z.strictObject({ apiTokenId: idParam }),
    response: { status: 200, description: "Das widerrufene Token.", schema: apiTokenSchema },
    problems: [404],
    handler: async ({ params, auth }) => {
      const record = await tokens.revoke(tenantOf(auth?.tenantId), params.apiTokenId);
      if (record === undefined) throw new NotFoundError();
      return toApiToken(record);
    },
  });

  return [list, create, revoke];
}
