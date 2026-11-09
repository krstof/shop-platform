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

// Mitarbeiter (E6 Teil 7, ADR-014). Nur IDs und Rolle, keine E-Mail-Adresse: Das Änderungsprotokoll
// wird nie gelöscht, die Adresse steht am Konto und lässt sich dort später unkenntlich machen.
const memberRole = z.enum(["owner", "staff", "custom"]);

export const memberInvited = defineEvent(
  "identity.member.invited.v1",
  z.strictObject({ id: z.uuid(), userId: z.uuid(), role: memberRole }),
);

export const memberJoined = defineEvent(
  "identity.member.joined.v1",
  z.strictObject({ id: z.uuid(), userId: z.uuid(), role: memberRole }),
);

export const memberRemoved = defineEvent(
  "identity.member.removed.v1",
  z.strictObject({
    id: z.uuid(),
    userId: z.uuid(),
    role: memberRole,
    previousStatus: z.enum(["invited", "active", "disabled"]),
    revokedApiTokens: z.number().int().nonnegative(),
  }),
);

export const identityEvents = [
  apiTokenCreated,
  apiTokenRevoked,
  memberInvited,
  memberJoined,
  memberRemoved,
] as const;
