// Mitarbeiter einladen, auflisten und entfernen (E6 Teil 7, SIC-03, Sicherheit 5.3, ADR-014).
//
// Zwei Rollen arbeiten zusammen, jede nur mit ihren Tabellen (ADR-008):
// - shop_app (hier): Mitgliedschaften des Shops (RLS), Ereignisse, Widerruf von API-Token.
// - shop_auth (IdentityService): Konto ohne Passwort anlegen, Einladungscode (nur SHA-256),
//   Passwort bei der Annahme setzen.
//
// Ablauf: Die Inhaberin lädt eine E-Mail-Adresse ein. Gibt es dazu noch kein Konto, entsteht eins
// ohne Passwort. Die Mitgliedschaft steht auf `invited` und zählt nirgends (memberships.ts), bis
// die eingeladene Person den Link aus der E-Mail benutzt; dann wird sie `active`. Entfernen löscht
// die Mitgliedschaft, widerruft alle API-Token, die im Namen dieses Kontos im Shop gelten, und
// macht einen offenen Einladungscode ungültig. Die Inhaberin kann nicht entfernt werden.
import {
  isUuid,
  publishEvent,
  withTenantTransaction,
  type Database,
  type Locale,
  type Logger,
  type Transaction,
} from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { apiTokenRevoked, memberInvited, memberJoined, memberRemoved } from "../identity.events.js";
import type { IdentityService } from "./identity-service.js";
import { PASSWORD_MESSAGES } from "./identity-service.js";
import {
  INVITATION_MAILS_PER_WINDOW,
  invitationLink,
  invitationMail,
  MAX_PENDING_INVITATIONS_PER_SHOP,
} from "./invitations.js";
import { checkNewPassword, type PasswordProblem } from "./password.js";
import { ResetMailLimiter, type MailSender } from "./password-reset.js";

/** Rollen, zu denen man heute einladen kann. Die Inhaberin gibt es je Shop genau einmal. */
export const INVITABLE_ROLES = ["staff"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type MemberStatus = "invited" | "active" | "disabled";
export type MemberRole = "owner" | "staff" | "custom";

export interface MemberRecord {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly invitedBy: string | null;
  readonly createdAt: Date;
}

export type InviteResult =
  | {
      readonly ok: true;
      readonly member: MemberRecord;
      /** `false`: Kein E-Mail-Versand eingerichtet, Versand gescheitert oder zu viele E-Mails. */
      readonly invitationSent: boolean;
      readonly invitationExpiresAt: Date;
    }
  | { readonly ok: false; readonly reason: "invalid_email" | "already_member" | "too_many_pending" };

export type RemoveResult =
  | { readonly ok: true; readonly member: MemberRecord; readonly revokedApiTokens: number }
  | { readonly ok: false; readonly reason: "not_found" | "owner" };

export type AcceptResult =
  | { readonly ok: true; readonly tenantId: string; readonly accountCreated: boolean }
  | { readonly ok: false; readonly reason: "invalid_code" | "password_required" }
  | {
      readonly ok: false;
      readonly reason: "weak_password";
      readonly problem: PasswordProblem;
      readonly message: string;
    };

export interface MemberService {
  /** Mitglieder des Shops, älteste zuerst (die Inhaberin also oben), seitenweise (`afterId`: Cursor). */
  list(
    tenantId: string,
    options: { readonly limit: number; readonly afterId?: string },
  ): Promise<MemberRecord[]>;
  /** Lädt eine E-Mail-Adresse ein. Läuft im Shop `tenantId`; `invitedBy` ist das einladende Konto. */
  invite(input: {
    readonly tenantId: string;
    readonly invitedBy: string;
    readonly email: string;
    readonly role: InvitableRole;
    /** Sprache für ein neu angelegtes Konto (und damit für die E-Mail). */
    readonly locale: Locale;
  }): Promise<InviteResult>;
  /** Entfernt ein Mitglied oder zieht eine Einladung zurück. */
  remove(tenantId: string, memberId: string): Promise<RemoveResult>;
  /** Einladung mit dem Code aus der E-Mail annehmen. Meldet nicht an. */
  accept(input: {
    readonly code: string;
    readonly password?: string | undefined;
    readonly name?: string | undefined;
  }): Promise<AcceptResult>;
}

export interface MemberServiceOptions {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  /** Anmeldemodul (shop_auth) für Konten und Codes. */
  readonly identity: Pick<
    IdentityService,
    "prepareInvitee" | "issueInvitationCode" | "findInvitation" | "redeemInvitation" | "withdrawInvitation"
  >;
  /** Ohne Angabe wird keine E-Mail verschickt (invitationSent: false). */
  readonly mailer?: MailSender;
  /** Adresse des Backoffice für den Link in der E-Mail. */
  readonly baseUrl: string;
  /** Name des Shops für die E-Mail (Modul platform, setzt apps/api zusammen). */
  readonly shopName?: (tenantId: string) => Promise<string | undefined>;
  readonly logger?: Logger;
  /** Nur für Tests. */
  readonly mailLimiter?: ResetMailLimiter;
  readonly now?: () => number;
}

const COLUMNS = [
  "m.id",
  "m.user_id",
  "m.role_key",
  "m.status",
  "m.invited_by",
  "m.created_at",
  "u.email",
  "u.name",
] as const;

interface MemberRow {
  id: string;
  user_id: string;
  role_key: string;
  status: string;
  invited_by: string | null;
  created_at: Date;
  email: string;
  name: string | null;
}

function toRecord(r: MemberRow): MemberRecord {
  return {
    id: r.id,
    userId: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role_key === "owner" || r.role_key === "staff" ? r.role_key : "custom",
    status: r.status === "invited" || r.status === "active" ? r.status : "disabled",
    invitedBy: r.invited_by,
    createdAt: r.created_at,
  };
}

export function createMemberService(options: MemberServiceOptions): MemberService {
  const database = options.database as Database<DB>;
  const { identity } = options;
  const now = options.now ?? Date.now;
  const limiter = options.mailLimiter ?? new ResetMailLimiter(now, INVITATION_MAILS_PER_WINDOW, 15 * 60);

  const select = (trx: Transaction<DB>) =>
    trx
      .selectFrom("identity.membership as m")
      .innerJoin("identity.user as u", "u.id", "m.user_id")
      .select(COLUMNS);

  async function sendInvitation(input: {
    tenantId: string;
    userId: string;
    email: string;
    name: string | null;
    locale: Locale;
    hasPassword: boolean;
    code: string;
  }): Promise<boolean> {
    if (options.mailer === undefined) {
      options.logger?.warn("Einladung: kein E-Mail-Versand eingerichtet");
      return false;
    }
    if (!limiter.take(`${input.tenantId}:${input.userId}`)) {
      options.logger?.info({ userId: input.userId }, "Einladung: zu viele E-Mails, diese entfällt");
      return false;
    }
    try {
      const shopName = await options.shopName?.(input.tenantId);
      await options.mailer.send(
        invitationMail({
          to: input.email,
          name: input.name,
          shopName,
          locale: input.locale,
          link: invitationLink(options.baseUrl, input.code),
          hasPassword: input.hasPassword,
        }),
      );
      options.logger?.info({ userId: input.userId }, "Einladung: E-Mail verschickt");
      return true;
    } catch (error) {
      // Ohne Empfänger und ohne Fehlertext: Meldungen von Mailservern nennen oft die Adresse.
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      options.logger?.error(
        { code: typeof code === "string" ? code : undefined },
        "Einladung: E-Mail-Versand gescheitert",
      );
      return false;
    }
  }

  return {
    async list(tenantId, { limit, afterId }) {
      const rows = await withTenantTransaction(
        database,
        (trx) => {
          let q = select(trx)
            .orderBy("m.id", "asc")
            .limit(limit + 1);
          if (afterId !== undefined) q = q.where("m.id", ">", afterId);
          return q.execute();
        },
        { tenantId },
      );
      return rows.map(toRecord);
    },

    async invite(input) {
      const invitee = await identity.prepareInvitee({ email: input.email, locale: input.locale });
      if (invitee === undefined) return { ok: false, reason: "invalid_email" };
      const outcome = await withTenantTransaction(
        database,
        async (trx): Promise<MemberRow | "already_member" | "too_many_pending"> => {
          const find = () =>
            select(trx).where("m.user_id", "=", invitee.userId).forUpdate("m").executeTakeFirst();
          let row = await find();
          if (row?.status === "active") return "already_member";
          if (row?.status !== "invited") {
            // Neue (oder nach Deaktivierung erneute) Einladung: Obergrenze offener Einladungen.
            // Weiche Grenze wie bei API-Token; zwei genau gleichzeitige Anfragen können sie um eins überschreiten.
            const { count } = await trx
              .selectFrom("identity.membership")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .where("status", "=", "invited")
              .executeTakeFirstOrThrow();
            if (Number(count) >= MAX_PENDING_INVITATIONS_PER_SHOP) return "too_many_pending";
          }
          if (row === undefined) {
            await trx
              .insertInto("identity.membership")
              .values({
                tenant_id: input.tenantId,
                user_id: invitee.userId,
                role_key: input.role,
                status: "invited",
                invited_by: input.invitedBy,
              })
              // Gleichzeitig schon eingeladen: dann gilt die Zeile der anderen Anfrage.
              .onConflict((oc) => oc.columns(["tenant_id", "user_id"]).doNothing())
              .execute();
            row = await find();
            if (row === undefined) throw new Error("Mitgliedschaft nicht lesbar");
            if (row.status === "active") return "already_member";
          } else {
            // Schon eingeladen (erneut senden) oder deaktiviert (wieder einladen).
            await trx
              .updateTable("identity.membership")
              .set({ status: "invited", role_key: input.role, role_id: null, invited_by: input.invitedBy })
              .where("id", "=", row.id)
              .execute();
            row = await find();
            if (row === undefined) throw new Error("Mitgliedschaft nicht lesbar");
          }
          await publishEvent(trx, memberInvited, { id: row.id, userId: row.user_id, role: input.role });
          return row;
        },
        { tenantId: input.tenantId, actorId: input.invitedBy },
      );
      if (outcome === "already_member" || outcome === "too_many_pending")
        return { ok: false, reason: outcome };
      const { code, expiresAt } = await identity.issueInvitationCode({
        tenantId: input.tenantId,
        userId: invitee.userId,
      });
      const invitationSent = await sendInvitation({ ...invitee, tenantId: input.tenantId, code });
      return { ok: true, member: toRecord(outcome), invitationSent, invitationExpiresAt: expiresAt };
    },

    async remove(tenantId, memberId) {
      if (!isUuid(memberId)) return { ok: false, reason: "not_found" };
      const outcome = await withTenantTransaction(
        database,
        async (trx) => {
          const row = await select(trx).where("m.id", "=", memberId).forUpdate("m").executeTakeFirst();
          if (row === undefined) return "not_found" as const;
          // Die Inhaberin kann weder sich selbst noch von jemand anderem entfernt werden. Eine
          // Übergabe des Shops kommt später als eigener Ablauf.
          if (row.role_key === "owner") return "owner" as const;
          await trx.deleteFrom("identity.membership").where("id", "=", row.id).execute();
          // Token im Namen dieses Kontos: sofort und endgültig widerrufen. Sie gälten ohnehin nicht
          // mehr (keine Mitgliedschaft), aber eine neue Einladung soll sie nicht wiederbeleben.
          const revoked = await trx
            .updateTable("identity.api_token")
            .set({ revoked_at: new Date(now()) })
            .where("issued_for_user_id", "=", row.user_id)
            .where("revoked_at", "is", null)
            .returning(["id", "name", "token_prefix"])
            .execute();
          for (const t of revoked)
            await publishEvent(trx, apiTokenRevoked, { id: t.id, name: t.name, prefix: t.token_prefix });
          await publishEvent(trx, memberRemoved, {
            id: row.id,
            userId: row.user_id,
            role: toRecord(row).role,
            previousStatus: toRecord(row).status,
            revokedApiTokens: revoked.length,
          });
          return { row, revoked: revoked.length };
        },
        { tenantId },
      );
      if (outcome === "not_found" || outcome === "owner") return { ok: false, reason: outcome };
      // Den Code gibt es nur noch bei offenen Einladungen. Ohne Mitgliedschaft wäre er ohnehin
      // wertlos (accept prüft sie); Löschen räumt nur auf und darf die Antwort nicht scheitern lassen.
      await identity.withdrawInvitation({ tenantId, userId: outcome.row.user_id }).catch(() => {
        options.logger?.warn("Einladung: Code ließ sich nicht löschen");
      });
      return { ok: true, member: toRecord(outcome.row), revokedApiTokens: outcome.revoked };
    },

    async accept(input) {
      const invalid = { ok: false, reason: "invalid_code" } as const;
      const invitation = await identity.findInvitation(input.code);
      if (invitation === undefined) return invalid;
      const { tenantId, userId } = invitation;
      const stillInvited = async () =>
        (await withTenantTransaction(
          database,
          (trx) =>
            trx
              .selectFrom("identity.membership")
              .select("id")
              .where("user_id", "=", userId)
              .where("status", "=", "invited")
              .executeTakeFirst(),
          { tenantId, actorId: userId },
        )) !== undefined;
      // Zurückgezogen oder entfernt: Der Code gilt nicht mehr, auch wenn er noch in der Tabelle steht.
      if (!(await stillInvited())) return invalid;
      let newPassword: string | undefined;
      if (!invitation.hasPassword) {
        if (input.password === undefined || input.password === "")
          return { ok: false, reason: "password_required" };
        // Erst die Regeln prüfen, dann den Code verbrauchen: Ein zu schwaches Passwort kostet ihn nicht.
        const problem = checkNewPassword(input.password, invitation.email);
        if (problem !== undefined)
          return { ok: false, reason: "weak_password", problem, message: PASSWORD_MESSAGES[problem] };
        newPassword = input.password;
      }
      const redeemed = await identity.redeemInvitation({
        code: input.code,
        tenantId,
        userId,
        ...(newPassword === undefined ? {} : { newPassword }),
        ...(input.name === undefined ? {} : { name: input.name }),
      });
      if (!redeemed) return invalid;
      const joined = await withTenantTransaction(
        database,
        async (trx) => {
          const row = await trx
            .updateTable("identity.membership")
            .set({ status: "active" })
            .where("user_id", "=", userId)
            .where("status", "=", "invited")
            .returning(["id", "role_key"])
            .executeTakeFirst();
          if (row === undefined) return false;
          await publishEvent(trx, memberJoined, {
            id: row.id,
            userId,
            role: row.role_key === "owner" || row.role_key === "staff" ? row.role_key : "custom",
          });
          return true;
        },
        { tenantId, actorId: userId },
      );
      // Zwischen Prüfung und Annahme zurückgezogen: Der Code ist verbraucht, es passiert nichts.
      if (!joined) return invalid;
      return { ok: true, tenantId, accountCreated: !invitation.hasPassword };
    },
  };
}
