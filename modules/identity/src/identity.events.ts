// Ereignisse des Moduls identity (ADR-007). Name, Version und Zod-Schema an einer Stelle.
// Das Token selbst und sein Hash stehen nie in einem Ereignis, nur das Präfix zum Wiedererkennen.
import { defineEvent } from "@shop/kernel";
import { z } from "zod";

export const apiTokenCreated = defineEvent(
  "identity.api_token.created.v1",
  z.strictObject({
    id: z.uuid(),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(z.string()),
    expiresAt: z.string().nullable(),
  }),
);

export const apiTokenRevoked = defineEvent(
  "identity.api_token.revoked.v1",
  z.strictObject({ id: z.uuid(), name: z.string(), prefix: z.string() }),
);

export const identityEvents = [apiTokenCreated, apiTokenRevoked] as const;
