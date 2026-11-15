// Uhr verbinden (15.11.2026, Kristof: App für die Galaxy Watch, die neue Bestellungen zeigt).
// 1. Backoffice: POST /admin/v1/device-pairings erzeugt einen Kopplungscode (8 Ziffern, 10 Minuten).
// 2. Uhr: POST /auth/v1/device-pairings/claim mit dem Code bekommt ein API-Token, das nur Bestellungen
//    lesen darf (orders:read), im Namen des Kontos, das den Code erzeugt hat. Ältere Uhr-Token dieses
//    Kontos im Shop werden dabei widerrufen. Fehlversuche bremst die API je Netz.
import { defineEndpoint, timestamp, type Endpoint } from "@shop/http";
import {
  ForbiddenError,
  getContext,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
} from "@shop/kernel";
import { z } from "zod";
import type { ApiTokenService } from "../internal/api-tokens.js";
import { DEVICE_PAIRING_SECONDS, WATCH_TOKEN_NAME } from "../internal/device-pairing.js";
import type { IdentityService } from "../internal/identity-service.js";

export interface DeviceEndpointOptions {
  readonly identity: Pick<IdentityService, "issueDevicePairingCode" | "claimDevicePairingCode">;
  readonly tokens: ApiTokenService;
  /** Name des Shops für die Anzeige auf der Uhr. */
  readonly shopName?: ((tenantId: string) => Promise<string | undefined>) | undefined;
  /** Nur für Tests. */
  readonly now?: () => number;
}

/** Höchstens so viele Einlöse-Versuche je Netz im Zeitfenster (im Arbeitsspeicher). */
export const PAIRING_ATTEMPTS_PER_WINDOW = 10;
export const PAIRING_WINDOW_SECONDS = 10 * 60;

export function deviceEndpoints(options: DeviceEndpointOptions): Endpoint[] {
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();
  function allow(ip: string): boolean {
    const since = now() - PAIRING_WINDOW_SECONDS * 1000;
    const recent = (attempts.get(ip) ?? []).filter((t) => t > since);
    if (recent.length >= PAIRING_ATTEMPTS_PER_WINDOW) {
      attempts.set(ip, recent);
      return false;
    }
    recent.push(now());
    attempts.set(ip, recent);
    if (attempts.size > 10_000) attempts.clear();
    return true;
  }

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/device-pairings",
    operationId: "createDevicePairing",
    summary: "Uhr verbinden: Kopplungscode erzeugen",
    description:
      "Erzeugt einen Code aus 8 Ziffern, 10 Minuten gültig und nur einmal verwendbar. Auf der Uhr " +
      "eingetippt, bekommt sie ein Token, das nur Bestellungen lesen darf. Nur mit Anmeldung als Person " +
      "(nicht mit einem API-Token); ein neuer Code ersetzt den alten.",
    tags: ["Uhr"],
    access: { scopes: ["orders:read"] },
    idempotency: "none",
    body: z.strictObject({}).meta({ description: "Leer." }),
    bodyExample: {},
    response: {
      status: 201,
      description: "Der Kopplungscode.",
      schema: z
        .object({
          code: z.string().regex(/^\d{8}$/),
          expiresAt: timestamp,
          validSeconds: z.number().int(),
        })
        .meta({ id: "DevicePairing" }),
    },
    handler: async ({ auth }) => {
      const tenantId = getContext()?.tenantId;
      const actor = auth?.actor;
      const userId = actor?.type === "user" ? actor.id : undefined;
      if (tenantId === undefined || userId === undefined)
        throw new ForbiddenError({ detail: "Eine Uhr kann nur eine angemeldete Person verbinden." });
      const { code, expiresAt } = await options.identity.issueDevicePairingCode({ tenantId, userId });
      return { code, expiresAt: expiresAt.toISOString(), validSeconds: DEVICE_PAIRING_SECONDS };
    },
  });

  const claim = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/device-pairings/claim",
    operationId: "claimDevicePairing",
    summary: "Uhr verbinden: Code einlösen",
    description:
      "Die Uhr schickt den Kopplungscode aus dem Backoffice und bekommt ein API-Token, das nur " +
      "Bestellungen lesen darf (`Authorization: Bearer …`, dazu `Shop-Id`). Ungültige oder abgelaufene " +
      `Codes ergeben 404; nach ${PAIRING_ATTEMPTS_PER_WINDOW} Versuchen je Netz in ${PAIRING_WINDOW_SECONDS / 60} Minuten kommt 429.`,
    tags: ["Uhr"],
    access: { public: true, reason: "Die Uhr hat noch keine Anmeldung; der Code ist der Nachweis." },
    idempotency: "none",
    body: z.strictObject({
      code: z
        .string()
        .transform((c) => c.replace(/\s+/g, ""))
        .pipe(z.string().regex(/^\d{8}$/, "Bitte die 8 Ziffern aus dem Backoffice eingeben."))
        .meta({ description: "8 Ziffern, Leerzeichen sind egal." }),
    }),
    bodyExample: { code: "1234 5678" },
    response: {
      status: 200,
      description: "Token für die Uhr.",
      schema: z
        .object({
          token: z.string().meta({ description: "API-Token (nur orders:read). Nur in dieser Antwort." }),
          shopId: z.uuid(),
          shopName: z.string(),
        })
        .meta({ id: "DevicePairingClaimed" }),
    },
    problems: [404, 429],
    rateLimit: "login",
    handler: async ({ body, client }) => {
      if (!allow(client?.ip ?? "unbekannt"))
        throw new RateLimitedError({ retryAfterSeconds: PAIRING_WINDOW_SECONDS });
      const pairing = await options.identity.claimDevicePairingCode(body.code);
      if (pairing === undefined)
        throw new NotFoundError({
          detail: "Der Code stimmt nicht oder ist abgelaufen. Bitte einen neuen erzeugen.",
        });
      // Ältere Uhr-Token desselben Kontos im Shop widerrufen (eine Uhr je Konto und Shop).
      for (const t of await options.tokens.list(pairing.tenantId, { limit: 100 }))
        if (t.name === WATCH_TOKEN_NAME && t.issuedForUserId === pairing.userId && t.status === "active")
          await options.tokens.revoke(pairing.tenantId, t.id);
      const created = await options.tokens.create({
        tenantId: pairing.tenantId,
        userId: pairing.userId,
        name: WATCH_TOKEN_NAME,
        scopes: ["orders:read"],
      });
      if (!created.ok)
        throw new ServiceUnavailableError({
          detail:
            created.reason === "too_many_tokens"
              ? "Dieser Shop hat schon zu viele API-Token. Bitte im Backoffice welche widerrufen."
              : "Das Konto darf keine Bestellungen lesen.",
        });
      return {
        token: created.token,
        shopId: pairing.tenantId,
        shopName: (await options.shopName?.(pairing.tenantId)) ?? "Shop",
      };
    },
  });

  return [create, claim];
}
