// Anmeldung hinter einer eigenen Schnittstelle (Sicherheit 5.2: „damit ein Wechsel möglich bleibt“).
// Außerhalb dieses Moduls weiß niemand, dass Better Auth dahintersteht.
import { ConflictError, isUuid, ValidationError, type Locale, type SecretBox } from "@shop/kernel";
import { APIError } from "better-auth";
import { Kysely, PostgresDialect } from "kysely";
import { z } from "zod";
import type { DB } from "../db.generated.js";
import {
  CLIENT_IP_HEADER,
  createAuth,
  createAuthPool,
  SESSION_COOKIE_NAME,
  type Auth,
  type AuthOptions,
} from "./auth.js";
import { INVITATION_SECONDS, invitationIdentifier, parseInvitationIdentifier } from "./invitations.js";
import {
  DEVICE_PAIRING_SECONDS,
  hashPairingCode,
  newPairingCode,
  PAIRING_CODE_PATTERN,
} from "./device-pairing.js";
import { LoginThrottle, type AttemptKeys } from "./login-throttle.js";
import { checkNewPassword, hashPassword, verifyPassword, type PasswordProblem } from "./password.js";
import {
  hashResetCode,
  newResetCode,
  PASSWORD_RESET_SECONDS,
  passwordResetMail,
  RESET_CODE_PATTERN,
  ResetMailLimiter,
  resetLink,
  type MailSender,
} from "./password-reset.js";
import {
  LAST_SEEN_RESOLUTION_SECONDS,
  MAX_SECOND_FACTOR_FAILURES,
  PENDING_SECOND_FACTOR_SECONDS,
  SESSION_RULES,
  TWO_FACTOR_SETUP_SECONDS,
  type SessionKind,
} from "./session-rules.js";
import {
  newBackupCodes,
  newTotpSecret,
  otpauthUri,
  base32Encode,
  useBackupCode,
  verifyTotp,
} from "./totp.js";

export const PASSWORD_MESSAGES: Readonly<Record<PasswordProblem, string>> = {
  too_short: "Das Passwort muss mindestens 12 Zeichen lang sein.",
  too_long: "Das Passwort darf höchstens 128 Zeichen lang sein.",
  common: "Dieses Passwort ist zu bekannt und wird oft geraten. Bitte ein anderes wählen.",
  contains_email: "Das Passwort darf die E-Mail-Adresse nicht enthalten.",
};

const emailSchema = z.email().max(254);

export interface NewUser {
  readonly email: string;
  readonly password: string;
  readonly name?: string;
}

export interface SignInRequest {
  readonly email: string;
  readonly password: string;
  /** Adresse des Absenders, wie der Webserver sie ermittelt hat (nie eine Kopfzeile des Clients). */
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export type SignInResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly sessionId: string;
      readonly email: string;
      readonly createdAt: Date;
      readonly expiresAt: Date;
      /** Fertige `Set-Cookie`-Zeile für die Antwort. */
      readonly setCookie: string;
      /**
       * `true`: Das Konto hat Zwei-Faktor eingeschaltet. Die Sitzung gilt erst, wenn
       * `verifySecondFactor` einen richtigen Code bekommen hat (höchstens 10 Minuten lang).
       */
      readonly secondFactorRequired: boolean;
    }
  | {
      readonly ok: false;
      /** Immer gleich, egal ob E-Mail unbekannt oder Passwort falsch (Sicherheit 5.2). */
      readonly reason: "invalid_credentials";
    }
  | {
      readonly ok: false;
      /**
       * Zu viele Fehlversuche für dieses Konto oder aus diesem Netz (Bremse oder Sperre). Das
       * Passwort wurde gar nicht erst geprüft. Gilt für unbekannte E-Mails genauso.
       */
      readonly reason: "throttled";
      readonly retryAfterSeconds: number;
    };

export interface ActiveSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /**
   * `verified`: Zwei-Faktor ist eingeschaltet und für diese Sitzung bestätigt.
   * `not_enrolled`: Das Konto hat (noch) keinen zweiten Faktor.
   * Sitzungen, die noch auf den Code warten, liefert getSession gar nicht erst.
   */
  readonly secondFactor: "verified" | "not_enrolled";
  /**
   * Letzte Passworteingabe: die Anmeldung selbst oder später `confirmPassword`. Kritische Aktionen
   * verlangen höchstens 15 Minuten (REAUTHENTICATION_SECONDS).
   */
  readonly passwordConfirmedAt: Date;
}

export type ConfirmPasswordResult =
  | { readonly ok: true; readonly session: ActiveSession }
  | { readonly ok: false; readonly reason: "no_session" | "invalid_password" }
  | { readonly ok: false; readonly reason: "throttled"; readonly retryAfterSeconds: number };

export type VerifySecondFactorResult =
  | { readonly ok: true; readonly session: ActiveSession; readonly backupCodesLeft?: number }
  | {
      readonly ok: false;
      /**
       * `invalid_code`: falsch, schon benutzt oder abgelaufen. `no_session`: keine wartende Sitzung
       * (nie angemeldet, abgelaufen oder nach zu vielen falschen Codes beendet). `not_pending`: Die
       * Sitzung braucht keinen Code.
       */
      readonly reason: "invalid_code" | "no_session" | "not_pending";
    };

export interface TwoFactorSetup {
  /** Geheimnis zum Abtippen (Base32), falls die App keinen QR-Code lesen kann. */
  readonly secret: string;
  /** Inhalt des QR-Codes. */
  readonly otpauthUri: string;
  /** 10 Ersatzcodes, je einmal gültig. Werden nur jetzt gezeigt. */
  readonly backupCodes: readonly string[];
}

export type StartTwoFactorSetupResult =
  | { readonly ok: true; readonly setup: TwoFactorSetup }
  | { readonly ok: false; readonly reason: "no_session" | "invalid_password" | "already_enabled" }
  | { readonly ok: false; readonly reason: "throttled"; readonly retryAfterSeconds: number };

export type ConfirmTwoFactorSetupResult =
  | { readonly ok: true; readonly session: ActiveSession }
  | { readonly ok: false; readonly reason: "no_session" | "already_enabled" | "no_setup" | "invalid_code" };

export type ResetPasswordResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Code unbekannt, schon benutzt, abgelaufen oder durch einen neueren ersetzt. Alles sieht gleich aus. */
      readonly reason: "invalid_code";
    }
  | {
      readonly ok: false;
      /** Das neue Passwort erfüllt die Regeln nicht. Der Code bleibt dann gültig. */
      readonly reason: "weak_password";
      readonly problem: PasswordProblem;
      readonly message: string;
    };

/** Ein Konto, wie Einladungen es brauchen (members.ts). */
export interface Invitee {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly locale: Locale;
  /** `false`: Das Konto wurde für die Einladung angelegt und hat noch kein Passwort. */
  readonly hasPassword: boolean;
}

export interface PendingInvitation extends Invitee {
  readonly tenantId: string;
  readonly expiresAt: Date;
}

export interface IdentityService {
  /** Legt ein Konto mit Passwort an. Für die Plattform-Verwaltung (E7) und Tests. */
  createUser(input: NewUser): Promise<{ readonly userId: string }>;
  signIn(input: SignInRequest): Promise<SignInResult>;
  /** Liest die Sitzung aus der Kopfzeile `Cookie`. `undefined`: nicht (mehr) angemeldet. */
  getSession(cookieHeader: string | undefined): Promise<ActiveSession | undefined>;
  /** Beendet die Sitzung und liefert die `Set-Cookie`-Zeile, die das Cookie löscht. */
  signOut(cookieHeader: string | undefined): Promise<{ readonly clearCookie: string }>;
  /** Zweiter Schritt der Anmeldung: Code aus der App oder ein Ersatzcode. */
  verifySecondFactor(cookieHeader: string | undefined, code: string): Promise<VerifySecondFactorResult>;
  /** Zwei-Faktor einrichten, Schritt 1: Passwort erneut prüfen, Geheimnis und Ersatzcodes erzeugen. */
  startTwoFactorSetup(input: {
    readonly cookie: string | undefined;
    readonly password: string;
    readonly ipAddress?: string;
  }): Promise<StartTwoFactorSetupResult>;
  /**
   * Schritt 2: Mit einem Code aus der App bestätigen. Danach gilt Zwei-Faktor für das Konto, diese
   * Sitzung ist bestätigt und alle anderen Sitzungen des Kontos sind beendet.
   */
  confirmTwoFactorSetup(cookieHeader: string | undefined, code: string): Promise<ConfirmTwoFactorSetupResult>;
  /**
   * Passwort erneut eingeben, ohne sich neu anzumelden (für kritische Aktionen, Sicherheit 5.3).
   * Gebremst wie die Anmeldung: Fehlversuche zählen für Konto und Netz und können sperren.
   */
  confirmPassword(input: {
    readonly cookie: string | undefined;
    readonly password: string;
    readonly ipAddress?: string;
  }): Promise<ConfirmPasswordResult>;
  /**
   * „Passwort vergessen“: Kehrt sofort zurück, egal ob es die E-Mail gibt. Gibt es ein aktives
   * Konto, bekommt es im Hintergrund eine E-Mail mit einem Link (30 Minuten, einmal gültig).
   * `done` erfüllt sich, wenn der Hintergrund fertig ist (nur für Tests; scheitert nie).
   */
  requestPasswordReset(input: { readonly email: string }): { readonly done: Promise<void> };
  /**
   * Neues Passwort mit dem Code aus der E-Mail. Meldet nicht an, beendet alle Sitzungen des Kontos
   * und hebt eine Sperre nach Fehlversuchen auf. Zwei-Faktor bleibt unverändert.
   */
  resetPassword(input: { readonly code: string; readonly newPassword: string }): Promise<ResetPasswordResult>;
  /**
   * Nur für Testdaten (pnpm dev:seed, Testserver): setzt das Passwort eines bestehenden Kontos direkt,
   * ohne E-Mail. Gleiche Passwortregeln; beendet alle Sitzungen und hebt eine Sperre auf.
   * `false`, wenn es das Konto nicht gibt.
   */
  setPasswordForTestData(
    input: { readonly email: string } & (
      { readonly newPassword: string } | { readonly passwordHash: string }
    ),
  ): Promise<boolean>;
  /**
   * Einladungen (E6 Teil 7, ADR-014), nur für den MemberService dieses Moduls: Konto zur E-Mail
   * suchen oder ohne Passwort anlegen. `undefined`: keine gültige E-Mail-Adresse.
   */
  prepareInvitee(input: { readonly email: string; readonly locale: Locale }): Promise<Invitee | undefined>;
  /** Neuer Einladungscode (7 Tage), ersetzt einen älteren für denselben Shop und dasselbe Konto. */
  issueInvitationCode(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<{ readonly code: string; readonly expiresAt: Date }>;
  /**
   * Uhr verbinden (15.11.2026): neuer Kopplungscode (8 Ziffern, 10 Minuten), ersetzt einen älteren
   * für dasselbe Konto im selben Shop.
   */
  issueDevicePairingCode(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<{ readonly code: string; readonly expiresAt: Date }>;
  /** Verbraucht einen Kopplungscode (genau einmal). Ungültig oder abgelaufen: `undefined`. */
  claimDevicePairingCode(
    code: string,
  ): Promise<{ readonly tenantId: string; readonly userId: string } | undefined>;
  /** Liest einen Einladungscode, ohne ihn zu verbrauchen. Ungültig, abgelaufen oder Konto nicht aktiv: `undefined`. */
  findInvitation(code: string): Promise<PendingInvitation | undefined>;
  /**
   * Verbraucht den Code (von zwei gleichzeitigen Anfragen gewinnt genau eine). Hat das Konto noch
   * kein Passwort, wird `newPassword` gesetzt (Regeln vorher prüfen); ein vorhandenes Passwort
   * bleibt immer unverändert. Markiert die E-Mail als bestätigt. `false`: Code nicht (mehr) gültig.
   */
  redeemInvitation(input: {
    readonly code: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly newPassword?: string;
    readonly name?: string;
  }): Promise<boolean>;
  /** Macht einen offenen Einladungscode ungültig (Einladung zurückgezogen, Mitglied entfernt). */
  withdrawInvitation(input: { readonly tenantId: string; readonly userId: string }): Promise<void>;
  close(): Promise<void>;
}

function requestHeaders(input: { ipAddress?: string; userAgent?: string; cookie?: string }): Headers {
  const h = new Headers();
  if (input.ipAddress !== undefined) h.set(CLIENT_IP_HEADER, input.ipAddress);
  if (input.userAgent !== undefined) h.set("user-agent", input.userAgent.slice(0, 512));
  if (input.cookie !== undefined) h.set("cookie", input.cookie);
  return h;
}

function sessionCookieLine(headers: Headers): string {
  const line = headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (line === undefined) throw new Error("Better Auth hat kein Sitzungs-Cookie gesetzt");
  return line;
}

/** Löscht das Cookie im Browser, auch wenn es keine Sitzung (mehr) gibt. */
export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

export interface IdentityServiceOptions extends AuthOptions {
  /** Verschlüsselt TOTP-Geheimnisse und Ersatzcodes mit dem Hauptschlüssel (Sicherheit 5.10). */
  readonly secretBox: SecretBox;
  /**
   * Welche Sitzungsregeln für ein Konto gelten (session-rules.ts). Setzt apps/api aus dem Modul
   * platform zusammen. Ohne Angabe: überall die Regeln für Händler.
   */
  readonly sessionKindOf?: (userId: string) => Promise<SessionKind>;
  /**
   * Versand von E-Mails („Passwort vergessen“). Ohne Angabe verschickt das Modul nichts und
   * schreibt eine Warnung ins Protokoll.
   */
  readonly mailer?: MailSender;
  /** Nur für Tests: eigene Zählung der E-Mails je Konto. */
  readonly resetMailLimiter?: ResetMailLimiter;
  /** Name in der Authenticator-App. */
  readonly issuer?: string;
  /** Nur für Tests: eigene Bremse (etwa mit eigener Uhr). Standard: Werte aus Sicherheit 5.2. */
  readonly loginThrottle?: LoginThrottle;
  /** Nur für Tests: Uhr für die Sperre in der Datenbank. */
  readonly now?: () => number;
}

/** E-Mail so, wie sie gespeichert und gezählt wird. Sehr lange Eingaben werden gekürzt. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 320);
}

export function createIdentityService(options: IdentityServiceOptions): IdentityService {
  const pool = createAuthPool(options);
  const auth: Auth = createAuth(options, pool);
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const throttle = options.loginThrottle ?? new LoginThrottle();
  const now = options.now ?? Date.now;
  const box = options.secretBox;
  const issuer = options.issuer ?? "Shop-Plattform";
  const kindOf = options.sessionKindOf ?? (async () => "standard" as const);
  const resetLimiter = options.resetMailLimiter ?? new ResetMailLimiter(now);
  /** Laufende Hintergrundarbeiten; close() wartet auf sie. */
  const background = new Set<Promise<void>>();

  const secretPurpose = (userId: string) => `identity.two_factor.secret:${userId}`;
  const codesPurpose = (userId: string) => `identity.two_factor.backup_codes:${userId}`;

  /** Sperre aus der Datenbank (übersteht einen Neustart). Läuft für unbekannte E-Mails genauso. */
  async function lockedFor(email: string): Promise<number> {
    const row = await db
      .selectFrom("identity.user")
      .select("locked_until")
      .where("email", "=", email)
      .executeTakeFirst();
    const until = row?.locked_until;
    if (until === null || until === undefined) return 0;
    const ms = new Date(until).getTime() - now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  async function lockAccount(email: string, until: Date): Promise<void> {
    const result = await db
      .updateTable("identity.user")
      .set({ locked_until: until, updated_at: new Date(now()) })
      .where("email", "=", email)
      .executeTakeFirst();
    // Nur ein Hinweis fürs Protokoll, ohne E-Mail. Die E-Mail an den Inhaber kommt mit notifications.
    if (result.numUpdatedRows > 0n)
      options.logger?.warn({ until: until.toISOString() }, "Konto nach zu vielen Fehlversuchen gesperrt");
  }

  async function deleteByToken(token: string): Promise<void> {
    await (await auth.$context).internalAdapter.deleteSession(token);
  }

  interface RawSession {
    readonly token: string;
    readonly active: ActiveSession;
    readonly twoFactorEnabled: boolean;
    readonly verifiedAt: Date | null;
    readonly lastSeenAt: Date;
  }

  /**
   * Sitzung aus dem Cookie samt Zwei-Faktor-Zustand, nach den Regeln für Dauer und Aktivität.
   * Verstößt sie gegen eine Regel, wird sie gelöscht. Wartende Sitzungen kommen hier mit zurück.
   */
  async function readSession(cookieHeader: string | undefined): Promise<RawSession | undefined> {
    if (cookieHeader === undefined || !cookieHeader.includes(`${SESSION_COOKIE_NAME}=`)) return undefined;
    const result = await auth.api.getSession({
      headers: requestHeaders({ cookie: cookieHeader }),
      query: { disableRefresh: false },
    });
    if (result === null) return undefined;
    const { session, user } = result;
    const row = await db
      .selectFrom("identity.session as s")
      .innerJoin("identity.user as u", "u.id", "s.user_id")
      .select(["s.two_factor_verified_at", "s.last_seen_at", "s.reauthenticated_at", "u.two_factor_enabled"])
      .where("s.id", "=", session.id)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const t = now();
    const verifiedAt = row.two_factor_verified_at === null ? null : new Date(row.two_factor_verified_at);
    const lastSeenAt = new Date(row.last_seen_at);
    const pending = row.two_factor_enabled && verifiedAt === null;
    const age = t - session.createdAt.getTime();
    // Wartet die Sitzung auf den Code, gilt die kurze Frist; sonst die Regeln des Kontos.
    const rules = SESSION_RULES[await kindOf(user.id)];
    const expired = pending
      ? age > PENDING_SECOND_FACTOR_SECONDS * 1000
      : age > rules.maxAgeSeconds * 1000 || t - lastSeenAt.getTime() > rules.idleSeconds * 1000;
    if (expired) {
      await deleteByToken(session.token);
      return undefined;
    }
    return {
      token: session.token,
      twoFactorEnabled: row.two_factor_enabled,
      verifiedAt,
      lastSeenAt,
      active: {
        userId: user.id,
        sessionId: session.id,
        email: user.email,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        secondFactor: row.two_factor_enabled ? "verified" : "not_enrolled",
        passwordConfirmedAt:
          row.reauthenticated_at === null || new Date(row.reauthenticated_at) < session.createdAt
            ? session.createdAt
            : new Date(row.reauthenticated_at),
      },
    };
  }

  /**
   * Prüft das Passwort einer laufenden Sitzung erneut, gebremst und mit Sperre wie die Anmeldung
   * (ein gestohlenes Cookie allein reicht nicht, und Raten über diesen Weg ist genauso langsam).
   */
  async function recheckPassword(
    s: ActiveSession,
    password: string,
    ipAddress: string | undefined,
  ): Promise<"ok" | "invalid_password" | { readonly retryAfterSeconds: number }> {
    const keys: AttemptKeys = { email: normalizeEmail(s.email), ipAddress };
    const gate = throttle.check(keys);
    if (!gate.allowed) return { retryAfterSeconds: gate.retryAfterSeconds };
    const locked = await lockedFor(keys.email);
    if (locked > 0) return { retryAfterSeconds: locked };
    const account = await db
      .selectFrom("identity.account")
      .select("password_hash")
      .where("user_id", "=", s.userId)
      .where("provider_id", "=", "credential")
      .executeTakeFirst();
    const hash = account?.password_hash ?? null;
    if (hash === null || !(await verifyPassword(hash, password))) {
      const outcome = throttle.recordFailure(keys);
      if (outcome.accountLockedUntil !== undefined) await lockAccount(keys.email, outcome.accountLockedUntil);
      return "invalid_password";
    }
    throttle.recordSuccess(keys);
    return "ok";
  }

  /** Nur fertige Sitzungen (nicht wartend). Schiebt „zuletzt aktiv“ nach vorn. */
  async function activeSession(cookieHeader: string | undefined): Promise<ActiveSession | undefined> {
    const raw = await readSession(cookieHeader);
    if (raw === undefined || (raw.twoFactorEnabled && raw.verifiedAt === null)) return undefined;
    if (now() - raw.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_SECONDS * 1000) {
      await db
        .updateTable("identity.session")
        .set({ last_seen_at: new Date(now()) })
        .where("id", "=", raw.active.sessionId)
        .execute();
    }
    return raw.active;
  }

  type Trx = Parameters<Parameters<ReturnType<typeof db.transaction>["execute"]>[0]>[0];

  /** Zählt einen falschen Code. Liefert `true`, wenn die Sitzung deshalb beendet wurde. */
  async function countFailure(trx: Trx, sessionId: string): Promise<boolean> {
    const row = await trx
      .updateTable("identity.session")
      .set((eb) => ({ two_factor_failures: eb("two_factor_failures", "+", 1) }))
      .where("id", "=", sessionId)
      .returning("two_factor_failures")
      .executeTakeFirst();
    if (row !== undefined && row.two_factor_failures >= MAX_SECOND_FACTOR_FAILURES) {
      await trx.deleteFrom("identity.session").where("id", "=", sessionId).execute();
      options.logger?.warn({ sessionId }, "Sitzung nach zu vielen falschen Zwei-Faktor-Codes beendet");
      return true;
    }
    return false;
  }

  function markVerified(trx: Trx, sessionId: string) {
    return trx
      .updateTable("identity.session")
      .set({ two_factor_verified_at: new Date(now()), two_factor_failures: 0, last_seen_at: new Date(now()) })
      .where("id", "=", sessionId)
      .execute();
  }

  /** Hat das Konto ein Passwort? Eingeladene Konten haben bis zur Annahme keins. */
  async function hasPassword(userId: string): Promise<boolean> {
    const row = await db
      .selectFrom("identity.account")
      .select("id")
      .where("user_id", "=", userId)
      .where("provider_id", "=", "credential")
      .where("password_hash", "is not", null)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Hintergrund von „Passwort vergessen“: Konto suchen, Code speichern, E-Mail schicken. */
  async function sendPasswordReset(email: string): Promise<void> {
    if (!emailSchema.safeParse(email).success) return;
    const user = await db
      .selectFrom("identity.user")
      .select(["id", "email", "name", "locale", "status"])
      .where("email", "=", email)
      .executeTakeFirst();
    // Unbekannt, gesperrt oder deaktiviert: nichts tun. Die Antwort war schon gleich.
    if (user === undefined || user.status !== "active") return;
    if (options.mailer === undefined) {
      options.logger?.warn("Passwort vergessen: kein E-Mail-Versand eingerichtet");
      return;
    }
    if (!resetLimiter.take(user.id)) {
      options.logger?.info({ userId: user.id }, "Passwort vergessen: zu viele E-Mails, diese entfällt");
      return;
    }
    const { code, hash } = newResetCode();
    const at = new Date(now());
    await db.transaction().execute(async (trx) => {
      // Ein neuer Code ersetzt den alten; abgelaufene Codes aller Konten räumen wir gleich mit auf.
      await trx
        .deleteFrom("identity.verification")
        .where("purpose", "=", "password_reset")
        .where((eb) => eb.or([eb("identifier", "=", user.id), eb("expires_at", "<=", at)]))
        .execute();
      await trx
        .insertInto("identity.verification")
        .values({
          identifier: user.id,
          value_hash: hash,
          purpose: "password_reset",
          expires_at: new Date(at.getTime() + PASSWORD_RESET_SECONDS * 1000),
          created_at: at,
        })
        .execute();
    });
    await options.mailer.send(
      passwordResetMail({
        to: user.email,
        name: user.name,
        locale: (user.locale === "en" ? "en" : "de") satisfies Locale,
        link: resetLink(options.baseUrl, code),
      }),
    );
    options.logger?.info({ userId: user.id }, "Passwort vergessen: E-Mail verschickt");
  }

  return {
    async createUser(input) {
      const email = emailSchema.safeParse(input.email.trim().toLowerCase());
      if (!email.success) {
        throw new ValidationError({
          errors: [{ path: "/email", code: "invalid_email", message: "Keine gültige E-Mail-Adresse." }],
        });
      }
      const problem = checkNewPassword(input.password, email.data);
      if (problem !== undefined) {
        throw new ValidationError({
          errors: [{ path: "/password", code: `password_${problem}`, message: PASSWORD_MESSAGES[problem] }],
        });
      }
      const ctx = await auth.$context;
      if ((await ctx.internalAdapter.findUserByEmail(email.data, { includeAccounts: false })) !== null) {
        throw new ConflictError({ detail: "Diese E-Mail-Adresse ist bereits vergeben." });
      }
      const passwordHash = await hashPassword(input.password);
      const user = await ctx.internalAdapter.createUser(
        {
          email: email.data,
          name: input.name ?? "",
          emailVerified: false,
        },
        { method: "admin" },
      );
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      });
      return { userId: user.id };
    },

    async signIn(input) {
      const email = normalizeEmail(input.email);
      const keys: AttemptKeys = { email, ipAddress: input.ipAddress };
      // 1. Bremse und Sperre vor der Passwortprüfung: Gesperrt heißt gesperrt, auch mit richtigem Passwort.
      const gate = throttle.check(keys);
      if (!gate.allowed) return { ok: false, reason: "throttled", retryAfterSeconds: gate.retryAfterSeconds };
      const locked = await lockedFor(email);
      if (locked > 0) return { ok: false, reason: "throttled", retryAfterSeconds: locked };

      // 2. Better Auth prüft E-Mail und Passwort.
      try {
        const { headers, response } = await auth.api.signInEmail({
          body: { email, password: input.password, rememberMe: true },
          headers: requestHeaders(input),
          returnHeaders: true,
        });
        const session = await auth.api.getSession({
          headers: requestHeaders({ cookie: sessionCookieLine(headers).split(";")[0] ?? "" }),
        });
        if (session === null) throw new Error("Neue Sitzung nicht lesbar");
        throttle.recordSuccess(keys);
        const user = await db
          .selectFrom("identity.user")
          .select("two_factor_enabled")
          .where("id", "=", response.user.id)
          .executeTakeFirstOrThrow();
        return {
          ok: true,
          userId: response.user.id,
          sessionId: session.session.id,
          email: session.user.email,
          createdAt: session.session.createdAt,
          expiresAt: session.session.expiresAt,
          setCookie: sessionCookieLine(headers),
          secondFactorRequired: user.two_factor_enabled,
        };
      } catch (error) {
        // Unbekannte E-Mail, falsches Passwort und ungültiges Format sehen gleich aus.
        if (
          error instanceof APIError &&
          (error.status === "UNAUTHORIZED" || error.status === "BAD_REQUEST")
        ) {
          const outcome = throttle.recordFailure(keys);
          if (outcome.accountLockedUntil !== undefined) await lockAccount(email, outcome.accountLockedUntil);
          return { ok: false, reason: "invalid_credentials" };
        }
        throw error;
      }
    },

    getSession: activeSession,

    async signOut(cookieHeader) {
      if (cookieHeader !== undefined && cookieHeader.includes(`${SESSION_COOKIE_NAME}=`)) {
        try {
          await auth.api.signOut({ headers: requestHeaders({ cookie: cookieHeader }) });
        } catch (error) {
          if (!(error instanceof APIError)) throw error;
        }
      }
      return { clearCookie: CLEAR_SESSION_COOKIE };
    },

    async verifySecondFactor(cookieHeader, code) {
      const raw = await readSession(cookieHeader);
      if (raw === undefined) return { ok: false, reason: "no_session" };
      if (!raw.twoFactorEnabled || raw.verifiedAt !== null) return { ok: false, reason: "not_pending" };
      const { userId, sessionId } = raw.active;
      // Zeile sperren: Zwei gleichzeitige Anfragen mit demselben Code dürfen nicht beide gelten.
      const outcome = await db.transaction().execute(async (trx) => {
        const tf = await trx
          .selectFrom("identity.two_factor")
          .select(["secret_encrypted", "backup_codes_encrypted", "last_used_step"])
          .where("user_id", "=", userId)
          .where("enabled_at", "is not", null)
          .forUpdate()
          .executeTakeFirst();
        if (tf === undefined) throw new Error("Zwei-Faktor eingeschaltet, aber kein Geheimnis gespeichert");
        const secret = box.open(tf.secret_encrypted, secretPurpose(userId));
        try {
          const lastStep = tf.last_used_step === null ? undefined : Number(tf.last_used_step);
          const step = verifyTotp(secret, code, now(), lastStep);
          if (step !== undefined) {
            await trx
              .updateTable("identity.two_factor")
              .set({ last_used_step: step, updated_at: new Date(now()) })
              .where("user_id", "=", userId)
              .execute();
            await markVerified(trx, sessionId);
            return { ok: true as const };
          }
        } finally {
          secret.fill(0);
        }
        // Kein TOTP-Code: vielleicht ein Ersatzcode (enthält Buchstaben).
        if (/[a-z]/i.test(code)) {
          const codes = JSON.parse(
            box.open(tf.backup_codes_encrypted, codesPurpose(userId)).toString("utf8"),
          ) as string[];
          const rest = useBackupCode(codes, code);
          if (rest !== undefined) {
            await trx
              .updateTable("identity.two_factor")
              .set({
                backup_codes_encrypted: box.seal(Buffer.from(JSON.stringify(rest)), codesPurpose(userId)),
                updated_at: new Date(now()),
              })
              .where("user_id", "=", userId)
              .execute();
            await markVerified(trx, sessionId);
            options.logger?.info({ left: rest.length }, "Anmeldung mit Ersatzcode");
            return { ok: true as const, backupCodesLeft: rest.length };
          }
        }
        return (await countFailure(trx, sessionId))
          ? { ok: false as const, reason: "no_session" as const }
          : { ok: false as const, reason: "invalid_code" as const };
      });
      if (!outcome.ok) return outcome;
      const session: ActiveSession = { ...raw.active, secondFactor: "verified" };
      return outcome.backupCodesLeft === undefined
        ? { ok: true, session }
        : { ok: true, session, backupCodesLeft: outcome.backupCodesLeft };
    },

    async startTwoFactorSetup(input) {
      const s = await activeSession(input.cookie);
      if (s === undefined) return { ok: false, reason: "no_session" };
      if (s.secondFactor === "verified") return { ok: false, reason: "already_enabled" };
      // Erneute Passworteingabe, gebremst wie die Anmeldung (ein gestohlenes Cookie allein reicht nicht).
      const check = await recheckPassword(s, input.password, input.ipAddress);
      if (check === "invalid_password") return { ok: false, reason: "invalid_password" };
      if (check !== "ok")
        return { ok: false, reason: "throttled", retryAfterSeconds: check.retryAfterSeconds };
      const secret = newTotpSecret();
      const backupCodes = newBackupCodes();
      try {
        const values = {
          secret_encrypted: box.seal(secret, secretPurpose(s.userId)),
          backup_codes_encrypted: box.seal(Buffer.from(JSON.stringify(backupCodes)), codesPurpose(s.userId)),
          enabled_at: null,
          last_used_step: null,
          created_at: new Date(now()),
          updated_at: new Date(now()),
        };
        // Eine neue Einrichtung ersetzt eine angefangene, nie eine eingeschaltete.
        const written = await db
          .insertInto("identity.two_factor")
          .values({ user_id: s.userId, ...values })
          .onConflict((oc) =>
            oc.column("user_id").doUpdateSet(values).where("identity.two_factor.enabled_at", "is", null),
          )
          .executeTakeFirst();
        if ((written.numInsertedOrUpdatedRows ?? 0n) === 0n) return { ok: false, reason: "already_enabled" };
        await db
          .updateTable("identity.session")
          .set({ two_factor_failures: 0 })
          .where("id", "=", s.sessionId)
          .execute();
        return {
          ok: true,
          setup: {
            secret: base32Encode(secret),
            otpauthUri: otpauthUri(secret, s.email, issuer),
            backupCodes,
          },
        };
      } finally {
        secret.fill(0);
      }
    },

    async confirmTwoFactorSetup(cookieHeader, code) {
      const s = await activeSession(cookieHeader);
      if (s === undefined) return { ok: false, reason: "no_session" };
      if (s.secondFactor === "verified") return { ok: false, reason: "already_enabled" };
      const outcome = await db.transaction().execute(async (trx) => {
        const tf = await trx
          .selectFrom("identity.two_factor")
          .select(["secret_encrypted", "updated_at"])
          .where("user_id", "=", s.userId)
          .where("enabled_at", "is", null)
          .forUpdate()
          .executeTakeFirst();
        if (tf === undefined || now() - new Date(tf.updated_at).getTime() > TWO_FACTOR_SETUP_SECONDS * 1000)
          return "no_setup" as const;
        const secret = box.open(tf.secret_encrypted, secretPurpose(s.userId));
        let step: number | undefined;
        try {
          step = verifyTotp(secret, code, now(), undefined);
        } finally {
          secret.fill(0);
        }
        if (step === undefined)
          return (await countFailure(trx, s.sessionId)) ? ("no_session" as const) : ("invalid_code" as const);
        const at = new Date(now());
        await trx
          .updateTable("identity.two_factor")
          .set({ enabled_at: at, last_used_step: step, updated_at: at })
          .where("user_id", "=", s.userId)
          .execute();
        await trx
          .updateTable("identity.user")
          .set({ two_factor_enabled: true, updated_at: at })
          .where("id", "=", s.userId)
          .execute();
        await markVerified(trx, s.sessionId);
        // Andere Sitzungen stammen aus der Zeit ohne zweiten Faktor: beenden.
        await trx
          .deleteFrom("identity.session")
          .where("user_id", "=", s.userId)
          .where("id", "!=", s.sessionId)
          .execute();
        return "ok" as const;
      });
      if (outcome !== "ok") return { ok: false, reason: outcome };
      options.logger?.info({ userId: s.userId }, "Zwei-Faktor eingeschaltet");
      return { ok: true, session: { ...s, secondFactor: "verified" } };
    },

    async confirmPassword(input) {
      const s = await activeSession(input.cookie);
      if (s === undefined) return { ok: false, reason: "no_session" };
      const check = await recheckPassword(s, input.password, input.ipAddress);
      if (check === "invalid_password") return { ok: false, reason: "invalid_password" };
      if (check !== "ok")
        return { ok: false, reason: "throttled", retryAfterSeconds: check.retryAfterSeconds };
      const at = new Date(now());
      await db
        .updateTable("identity.session")
        .set({ reauthenticated_at: at, last_seen_at: at })
        .where("id", "=", s.sessionId)
        .execute();
      return { ok: true, session: { ...s, passwordConfirmedAt: at } };
    },

    requestPasswordReset(input) {
      const email = normalizeEmail(input.email);
      const done = sendPasswordReset(email).catch((error: unknown) => {
        // Ohne Empfänger und ohne Fehlertext: Meldungen von Mailservern nennen oft die Adresse.
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        options.logger?.error(
          { code: typeof code === "string" ? code : undefined },
          "Passwort vergessen: Hintergrund gescheitert",
        );
      });
      background.add(done);
      void done.finally(() => background.delete(done));
      return { done };
    },

    async setPasswordForTestData(input) {
      const email = normalizeEmail(input.email);
      const user = await db
        .selectFrom("identity.user")
        .select(["id"])
        .where("email", "=", email)
        .executeTakeFirst();
      if (user === undefined) return false;
      let passwordHash: string;
      if ("passwordHash" in input) {
        // Fertiger Prüfwert (Testserver): nur Argon2id mit den Werten dieses Moduls.
        if (!/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(input.passwordHash))
          throw new Error("Testpasswort: Prüfwert ist kein Argon2id-Hash dieses Moduls");
        passwordHash = input.passwordHash;
      } else {
        const problem = checkNewPassword(input.newPassword, email);
        if (problem !== undefined)
          throw new Error(`Testpasswort erfüllt die Regeln nicht: ${PASSWORD_MESSAGES[problem]}`);
        passwordHash = await hashPassword(input.newPassword);
      }
      const at = new Date(now());
      await db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable("identity.account")
          .set({ password_hash: passwordHash, updated_at: at })
          .where("user_id", "=", user.id)
          .where("provider_id", "=", "credential")
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n)
          await trx
            .insertInto("identity.account")
            .values({
              user_id: user.id,
              provider_id: "credential",
              account_id: user.id,
              password_hash: passwordHash,
            })
            .execute();
        await trx
          .updateTable("identity.user")
          .set({ locked_until: null, updated_at: at })
          .where("id", "=", user.id)
          .execute();
        await trx.deleteFrom("identity.session").where("user_id", "=", user.id).execute();
      });
      return true;
    },

    async resetPassword(input) {
      const invalid = { ok: false, reason: "invalid_code" } as const;
      if (!RESET_CODE_PATTERN.test(input.code)) return invalid;
      const hash = hashResetCode(input.code);
      const at = new Date(now());
      const found = await db
        .selectFrom("identity.verification")
        .select(["identifier", "expires_at"])
        .where("value_hash", "=", hash)
        .where("purpose", "=", "password_reset")
        .executeTakeFirst();
      if (found === undefined || new Date(found.expires_at) <= at || !isUuid(found.identifier))
        return invalid;
      const user = await db
        .selectFrom("identity.user")
        .select(["id", "email", "status"])
        .where("id", "=", found.identifier)
        .executeTakeFirst();
      if (user === undefined || user.status !== "active") return invalid;
      // Erst die Regeln prüfen, dann den Code verbrauchen: Ein zu schwaches Passwort kostet ihn nicht.
      const problem = checkNewPassword(input.newPassword, user.email);
      if (problem !== undefined)
        return { ok: false, reason: "weak_password", problem, message: PASSWORD_MESSAGES[problem] };
      const passwordHash = await hashPassword(input.newPassword);
      const changed = await db.transaction().execute(async (trx) => {
        // Löschen ist das Verbrauchen: Von zwei gleichzeitigen Anfragen bekommt nur eine die Zeile.
        const used = await trx
          .deleteFrom("identity.verification")
          .where("value_hash", "=", hash)
          .where("purpose", "=", "password_reset")
          .where("identifier", "=", user.id)
          .where("expires_at", ">", at)
          .returning("id")
          .executeTakeFirst();
        if (used === undefined) return false;
        const updated = await trx
          .updateTable("identity.account")
          .set({ password_hash: passwordHash, updated_at: at })
          .where("user_id", "=", user.id)
          .where("provider_id", "=", "credential")
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) {
          await trx
            .insertInto("identity.account")
            .values({
              user_id: user.id,
              provider_id: "credential",
              account_id: user.id,
              password_hash: passwordHash,
            })
            .execute();
        }
        // Wer den Link aus dem Postfach benutzt, hat die Adresse bestätigt. Eine Sperre nach
        // Fehlversuchen schützte das alte Passwort und fällt weg.
        await trx
          .updateTable("identity.user")
          .set({ email_verified: true, locked_until: null, updated_at: at })
          .where("id", "=", user.id)
          .execute();
        // Alle Sitzungen beenden, auch die eines Angreifers mit dem alten Passwort.
        await trx.deleteFrom("identity.session").where("user_id", "=", user.id).execute();
        return true;
      });
      if (!changed) return invalid;
      throttle.recordSuccess({ email: normalizeEmail(user.email) });
      options.logger?.info({ userId: user.id }, "Passwort über den Link aus der E-Mail neu gesetzt");
      return { ok: true };
    },

    async prepareInvitee(input) {
      const parsed = emailSchema.safeParse(normalizeEmail(input.email));
      if (!parsed.success) return undefined;
      const email = parsed.data;
      const find = () =>
        db
          .selectFrom("identity.user")
          .select(["id", "email", "name", "locale"])
          .where("email", "=", email)
          .executeTakeFirst();
      let user = await find();
      if (user === undefined) {
        try {
          // Konto ohne Passwort (keine Zeile in identity.account): Anmelden geht erst nach der Annahme.
          await db
            .insertInto("identity.user")
            .values({ email, name: null, locale: input.locale, email_verified: false })
            .execute();
        } catch (error) {
          // Zwei Einladungen gleichzeitig an dieselbe neue Adresse: Die andere war schneller.
          if (!(typeof error === "object" && error !== null && "code" in error && error.code === "23505"))
            throw error;
        }
        user = await find();
        if (user === undefined) throw new Error("Eingeladenes Konto nicht lesbar");
      }
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale === "en" ? "en" : "de",
        hasPassword: await hasPassword(user.id),
      };
    },

    async issueInvitationCode(input) {
      if (!isUuid(input.tenantId) || !isUuid(input.userId)) throw new TypeError("Keine UUID");
      const identifier = invitationIdentifier(input.tenantId, input.userId);
      const { code, hash } = newResetCode();
      const at = new Date(now());
      const expiresAt = new Date(at.getTime() + INVITATION_SECONDS * 1000);
      await db.transaction().execute(async (trx) => {
        // Eine neue Einladung ersetzt die alte; abgelaufene Einladungen räumen wir gleich mit auf.
        await trx
          .deleteFrom("identity.verification")
          .where("purpose", "=", "invitation")
          .where((eb) => eb.or([eb("identifier", "=", identifier), eb("expires_at", "<=", at)]))
          .execute();
        await trx
          .insertInto("identity.verification")
          .values({
            identifier,
            value_hash: hash,
            purpose: "invitation",
            expires_at: expiresAt,
            created_at: at,
          })
          .execute();
      });
      return { code, expiresAt };
    },

    async issueDevicePairingCode(input) {
      if (!isUuid(input.tenantId) || !isUuid(input.userId)) throw new TypeError("Keine UUID");
      const identifier = invitationIdentifier(input.tenantId, input.userId);
      const at = new Date(now());
      const expiresAt = new Date(at.getTime() + DEVICE_PAIRING_SECONDS * 1000);
      for (let attempt = 0; ; attempt++) {
        const code = newPairingCode();
        try {
          await db.transaction().execute(async (trx) => {
            await trx
              .deleteFrom("identity.verification")
              .where("purpose", "=", "device_pairing")
              .where((eb) => eb.or([eb("identifier", "=", identifier), eb("expires_at", "<=", at)]))
              .execute();
            await trx
              .insertInto("identity.verification")
              .values({
                identifier,
                value_hash: hashPairingCode(code),
                purpose: "device_pairing",
                expires_at: expiresAt,
                created_at: at,
              })
              .execute();
          });
          return { code, expiresAt };
        } catch (error) {
          // Zufällig gleicher Code wie ein anderer gerade gültiger: neuer Versuch.
          if (attempt >= 4) throw error;
        }
      }
    },

    async claimDevicePairingCode(code) {
      if (!PAIRING_CODE_PATTERN.test(code)) return undefined;
      const row = await db
        .deleteFrom("identity.verification")
        .where("value_hash", "=", hashPairingCode(code))
        .where("purpose", "=", "device_pairing")
        .where("expires_at", ">", new Date(now()))
        .returning("identifier")
        .executeTakeFirst();
      if (row === undefined) return undefined;
      return parseInvitationIdentifier(row.identifier);
    },

    async findInvitation(code) {
      if (!RESET_CODE_PATTERN.test(code)) return undefined;
      const found = await db
        .selectFrom("identity.verification")
        .select(["identifier", "expires_at"])
        .where("value_hash", "=", hashResetCode(code))
        .where("purpose", "=", "invitation")
        .executeTakeFirst();
      if (found === undefined || new Date(found.expires_at) <= new Date(now())) return undefined;
      const ids = parseInvitationIdentifier(found.identifier);
      if (ids === undefined) return undefined;
      const user = await db
        .selectFrom("identity.user")
        .select(["id", "email", "name", "locale", "status"])
        .where("id", "=", ids.userId)
        .executeTakeFirst();
      if (user === undefined || user.status !== "active") return undefined;
      return {
        tenantId: ids.tenantId,
        userId: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale === "en" ? "en" : "de",
        hasPassword: await hasPassword(user.id),
        expiresAt: new Date(found.expires_at),
      };
    },

    async redeemInvitation(input) {
      if (!RESET_CODE_PATTERN.test(input.code)) return false;
      const hash = hashResetCode(input.code);
      const identifier = invitationIdentifier(input.tenantId, input.userId);
      // Argon2id vor der Transaktion: Es dauert, und die Transaktion soll kurz bleiben.
      const passwordHash =
        input.newPassword === undefined ? undefined : await hashPassword(input.newPassword);
      const at = new Date(now());
      const redeemed = await db.transaction().execute(async (trx) => {
        // Löschen ist das Verbrauchen: Von zwei gleichzeitigen Anfragen bekommt nur eine die Zeile.
        const used = await trx
          .deleteFrom("identity.verification")
          .where("value_hash", "=", hash)
          .where("purpose", "=", "invitation")
          .where("identifier", "=", identifier)
          .where("expires_at", ">", at)
          .returning("id")
          .executeTakeFirst();
        if (used === undefined) return false;
        if (passwordHash !== undefined) {
          // Nur ein fehlendes Passwort wird gesetzt, ein vorhandenes nie überschrieben: Eine Einladung
          // ist kein Weg, das Passwort eines bestehenden Kontos zu ändern.
          const existing = await trx
            .selectFrom("identity.account")
            .select(["id", "password_hash"])
            .where("user_id", "=", input.userId)
            .where("provider_id", "=", "credential")
            .forUpdate()
            .executeTakeFirst();
          if (existing === undefined) {
            await trx
              .insertInto("identity.account")
              .values({
                user_id: input.userId,
                provider_id: "credential",
                account_id: input.userId,
                password_hash: passwordHash,
              })
              .execute();
          } else if (existing.password_hash === null) {
            await trx
              .updateTable("identity.account")
              .set({ password_hash: passwordHash, updated_at: at })
              .where("id", "=", existing.id)
              .execute();
          }
        }
        // Den Namen nur setzen, wenn das Konto noch keinen hat (ein bestehendes Konto behält seinen).
        const name = input.name?.trim() ?? "";
        const current = await trx
          .selectFrom("identity.user")
          .select("name")
          .where("id", "=", input.userId)
          .forUpdate()
          .executeTakeFirst();
        await trx
          .updateTable("identity.user")
          .set({
            // Wer den Link aus dem Postfach benutzt, hat die Adresse bestätigt.
            email_verified: true,
            updated_at: at,
            ...(name !== "" && (current?.name ?? "") === "" ? { name } : {}),
          })
          .where("id", "=", input.userId)
          .execute();
        return true;
      });
      if (redeemed) options.logger?.info({ userId: input.userId }, "Einladung angenommen");
      return redeemed;
    },

    async withdrawInvitation(input) {
      if (!isUuid(input.tenantId) || !isUuid(input.userId)) return;
      await db
        .deleteFrom("identity.verification")
        .where("purpose", "=", "invitation")
        .where("identifier", "=", invitationIdentifier(input.tenantId, input.userId))
        .execute();
    },

    async close() {
      await Promise.allSettled([...background]);
      await db.destroy();
    },
  };
}
