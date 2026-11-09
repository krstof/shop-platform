// Mitarbeiter in der Admin-API und Annahme einer Einladung in der Auth-API (E6 Teil 7, SIC-03,
// Sicherheit 5.3, ADR-014). Verwalten darf nur die Inhaberin (members:*), nie ein API-Token.
// Einladen verlangt zusätzlich eine Sitzung und eine Passworteingabe vor höchstens 15 Minuten.
import {
  decodeCursor,
  defineEndpoint,
  idParam,
  listQuery,
  pageOf,
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
  INVITATION_PATH,
  INVITATION_SECONDS,
  MAX_PENDING_INVITATIONS_PER_SHOP,
} from "../internal/invitations.js";
import { INVITABLE_ROLES, type MemberRecord, type MemberService } from "../internal/members.js";
import { REAUTHENTICATION_SECONDS } from "../internal/session-rules.js";

export interface MemberEndpointOptions {
  readonly members: MemberService;
  /** Nur für Tests. */
  readonly now?: () => number;
}

const memberSchema = z
  .object({
    id: z.uuid().describe("Kennung der Mitgliedschaft (nicht des Kontos)."),
    userId: z.uuid(),
    email: z.string(),
    name: z.string().nullable(),
    role: z
      .enum(["owner", "staff", "custom"])
      .describe(
        "owner: Inhaberin oder Inhaber. staff: Mitarbeiterin oder Mitarbeiter. custom: eigene Rolle (ab Welle 5).",
      ),
    status: z
      .enum(["invited", "active", "disabled"])
      .describe(
        "invited: eingeladen, noch nicht angenommen. active: arbeitet im Shop mit. disabled: deaktiviert.",
      ),
    invitedBy: z.uuid().nullable().describe("Konto, das eingeladen hat."),
    createdAt: timestamp,
  })
  .meta({ id: "Member", description: "Mitglied eines Shops." });

const invitedMemberSchema = memberSchema
  .extend({
    invitationSent: z
      .boolean()
      .describe(
        "false: Die E-Mail ging nicht hinaus (etwa zu viele in kurzer Zeit). Später erneut einladen.",
      ),
    invitationExpiresAt: timestamp.describe("Bis dann gilt der Link in der E-Mail."),
  })
  .meta({ id: "InvitedMember" });

const removedMemberSchema = z
  .object({
    id: z.uuid(),
    removed: z.literal(true),
    revokedApiTokens: z
      .number()
      .int()
      .describe("So viele API-Token im Namen dieses Kontos wurden dabei widerrufen."),
  })
  .meta({ id: "RemovedMember" });

const acceptedInvitationSchema = z
  .object({
    joined: z.literal(true),
    shopId: z.uuid().describe("Shop, in dem das Konto jetzt mitarbeitet."),
    accountCreated: z
      .boolean()
      .describe(
        "true: Das Konto war neu und hat jetzt das gewählte Passwort. false: Das Passwort blieb, wie es war.",
      ),
  })
  .meta({ id: "AcceptedInvitation" });

function toMember(r: MemberRecord) {
  return {
    id: r.id,
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt.toISOString(),
  };
}

const TEXTS = {
  sessionOnly: {
    de: "Mitarbeiter lassen sich nur mit einer Anmeldung im Backoffice einladen, nicht mit einem Token.",
    en: "Team members can only be invited when signed in, not with a token.",
  },
  invalidEmail: { de: "Keine gültige E-Mail-Adresse.", en: "Not a valid email address." },
  alreadyMember: {
    de: "Diese Person arbeitet schon in diesem Shop mit.",
    en: "This person is already a member of this shop.",
  },
  tooManyPending: {
    de: `Höchstens ${MAX_PENDING_INVITATIONS_PER_SHOP} offene Einladungen je Shop. Bitte zuerst alte zurückziehen.`,
    en: `At most ${MAX_PENDING_INVITATIONS_PER_SHOP} open invitations per shop. Please withdraw old ones first.`,
  },
  owner: {
    de: "Die Inhaberin oder der Inhaber kann nicht entfernt werden.",
    en: "The shop owner cannot be removed.",
  },
  invalidCode: {
    de: "Die Einladung ist ungültig, schon angenommen, zurückgezogen oder abgelaufen.",
    en: "The invitation is invalid, already accepted, withdrawn or expired.",
  },
  passwordRequired: {
    de: "Für das neue Konto bitte ein Passwort wählen.",
    en: "Please choose a password for the new account.",
  },
} as const satisfies Record<string, Record<Locale, string>>;

const cursorKey = z.strictObject({ id: z.uuid() });

export function memberEndpoints(options: MemberEndpointOptions): Endpoint[] {
  const { members } = options;
  const now = options.now ?? Date.now;
  const tenantOf = (tenantId: string | undefined): string => {
    // Der Router lässt Admin-Anfragen ohne Shop gar nicht durch; fehlt er, ist das ein Programmfehler.
    if (tenantId === undefined) throw new Error("Admin-Endpunkt ohne Shop");
    return tenantId;
  };

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/members",
    operationId: "listMembers",
    summary: "Mitglieder auflisten",
    description:
      "Listet alle Mitglieder des Shops mit Rolle und Status, älteste zuerst (die Inhaberin also oben), " +
      "auch offene Einladungen.",
    tags: ["Mitarbeiter"],
    access: { scopes: ["members:read"] },
    query: listQuery(),
    response: { status: 200, description: "Eine Seite mit Mitgliedern.", schema: pageOf(memberSchema) },
    handler: async ({ query, auth, locale }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const rows = await members.list(tenantOf(auth?.tenantId), {
        limit: query.limit,
        ...(after === undefined ? {} : { afterId: after }),
      });
      return toPage(rows, query.limit, (r) => ({ id: r.id }), toMember);
    },
  });

  const invite = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/members",
    operationId: "inviteMember",
    summary: "Mitarbeiter einladen",
    description:
      "Lädt eine E-Mail-Adresse als Mitarbeiterin oder Mitarbeiter ein. Die Person bekommt eine E-Mail mit " +
      `einem Link ins Backoffice (${INVITATION_PATH}#code=…), der ${INVITATION_SECONDS / 86_400} Tage und ` +
      "einmal gilt; bis zur Annahme hat sie keinen Zugang (Status invited). Gibt es zur Adresse noch kein " +
      "Konto, entsteht eins ohne Passwort; das Passwort wählt die Person bei der Annahme. Erneut einladen " +
      "schickt einen neuen Link und macht den alten ungültig. Verlangt eine Anmeldung (kein Token) und eine " +
      "Passworteingabe vor höchstens 15 Minuten; sonst 403 reauthentication_required. Schon Mitglied: 409.",
    tags: ["Mitarbeiter"],
    access: { scopes: ["members:write"] },
    body: z.strictObject({
      email: z
        .string()
        .min(1)
        .max(320)
        .describe("E-Mail-Adresse der Person (Groß- und Kleinschreibung egal)."),
      role: z
        .enum(INVITABLE_ROLES)
        .describe("Rolle im Shop. Heute nur staff; eine zweite Inhaberin gibt es nicht."),
    }),
    bodyExample: { email: "mitarbeiter@teeladen.example", role: "staff" },
    response: { status: 201, description: "Eingeladen.", schema: invitedMemberSchema },
    problems: [409],
    handler: async ({ body, auth, locale }) => {
      if (auth?.actor.type !== "user" || auth.actor.id === undefined)
        throw new ForbiddenError({ detail: TEXTS.sessionOnly[locale] });
      const confirmed = auth.passwordConfirmedAt;
      if (confirmed === undefined || now() - confirmed.getTime() > REAUTHENTICATION_SECONDS * 1000)
        throw new ReauthenticationRequiredError();
      const result = await members.invite({
        tenantId: tenantOf(auth.tenantId),
        invitedBy: auth.actor.id,
        email: body.email,
        role: body.role,
        locale,
      });
      if (!result.ok) {
        if (result.reason === "invalid_email")
          throw new ValidationError({
            errors: [{ path: "/body/email", code: "invalid_email", message: TEXTS.invalidEmail[locale] }],
          });
        throw new ConflictError({
          detail: (result.reason === "already_member" ? TEXTS.alreadyMember : TEXTS.tooManyPending)[locale],
        });
      }
      return {
        ...toMember(result.member),
        invitationSent: result.invitationSent,
        invitationExpiresAt: result.invitationExpiresAt.toISOString(),
      };
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/members/{memberId}",
    operationId: "removeMember",
    summary: "Mitglied entfernen",
    description:
      "Entfernt eine Mitarbeiterin oder einen Mitarbeiter aus dem Shop oder zieht eine offene Einladung " +
      "zurück. Wirkt sofort bei der nächsten Anfrage. Alle API-Token, die im Namen dieses Kontos im Shop " +
      "gelten, werden dabei widerrufen. Das Konto selbst bleibt bestehen (es kann zu anderen Shops gehören). " +
      "Die Inhaberin kann nicht entfernt werden: 409.",
    tags: ["Mitarbeiter"],
    access: { scopes: ["members:write"] },
    params: z.strictObject({ memberId: idParam }),
    response: { status: 200, description: "Entfernt.", schema: removedMemberSchema },
    problems: [404, 409],
    handler: async ({ params, auth, locale }) => {
      const result = await members.remove(tenantOf(auth?.tenantId), params.memberId);
      if (!result.ok) {
        if (result.reason === "not_found") throw new NotFoundError();
        throw new ConflictError({ detail: TEXTS.owner[locale] });
      }
      return { id: result.member.id, removed: true as const, revokedApiTokens: result.revokedApiTokens };
    },
  });

  const accept = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/invitations/accept",
    operationId: "acceptInvitation",
    summary: "Einladung annehmen",
    description:
      "Nimmt mit dem Code aus dem Link eine Einladung an; danach arbeitet das Konto im Shop mit. Meldet " +
      "nicht an: Danach ganz normal anmelden. War das Konto neu, ist password Pflicht (sonst 422 " +
      "password_required, der Code bleibt gültig) und wird das Passwort des Kontos; die Regeln sind " +
      "dieselben wie überall (mindestens 12 Zeichen, nicht zu bekannt, ohne die E-Mail). Hat das Konto " +
      "schon ein Passwort, wird password nicht beachtet und nichts daran geändert. Unbekannter, benutzter, " +
      "zurückgezogener oder abgelaufener Code: 422 invalid_invitation_code.",
    tags: ["Anmeldung"],
    access: { public: true, reason: "Eingeladene haben oft noch gar kein Passwort." },
    body: z.strictObject({
      code: z.string().min(1).max(128).describe("Code aus dem Link in der E-Mail (der Teil nach #code=)."),
      password: z.string().min(1).max(1024).optional().describe("Neues Passwort, nur für neue Konten."),
      name: z
        .string()
        .max(100)
        .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "Nur eine Zeile ohne Steuerzeichen.")
        .optional()
        .describe("Name, wie ihn das Team sieht. Nur, wenn das Konto noch keinen hat."),
    }),
    bodyExample: {
      code: "q3v8yQ0lRk2c5wP1bT9mN4xZ7hJ6sD0aF8gK2eL5uIo",
      password: "vier kleine teekannen",
      name: "Jonas",
    },
    idempotency: "none",
    response: { status: 200, description: "Angenommen.", schema: acceptedInvitationSchema },
    handler: async ({ body, locale }) => {
      const result = await members.accept({ code: body.code, password: body.password, name: body.name });
      if (result.ok)
        return { joined: true as const, shopId: result.tenantId, accountCreated: result.accountCreated };
      if (result.reason === "weak_password")
        throw new ValidationError({
          errors: [{ path: "/body/password", code: `password_${result.problem}`, message: result.message }],
        });
      if (result.reason === "password_required")
        throw new ValidationError({
          errors: [
            { path: "/body/password", code: "password_required", message: TEXTS.passwordRequired[locale] },
          ],
        });
      throw new ValidationError({
        errors: [{ path: "/body/code", code: "invalid_invitation_code", message: TEXTS.invalidCode[locale] }],
      });
    },
  });

  return [list, invite, remove, accept];
}
