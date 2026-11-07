// Anmeldung hinter einer eigenen Schnittstelle (Sicherheit 5.2: „damit ein Wechsel möglich bleibt“).
// Außerhalb dieses Moduls weiß niemand, dass Better Auth dahintersteht.
import { ConflictError, ValidationError, type SecretBox } from "@shop/kernel";
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
import { LoginThrottle, type AttemptKeys } from "./login-throttle.js";
import { checkNewPassword, hashPassword, verifyPassword, type PasswordProblem } from "./password.js";
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

const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
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
}

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
      .select(["s.two_factor_verified_at", "s.last_seen_at", "u.two_factor_enabled"])
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
      },
    };
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
      const keys: AttemptKeys = { email: normalizeEmail(s.email), ipAddress: input.ipAddress };
      const gate = throttle.check(keys);
      if (!gate.allowed) return { ok: false, reason: "throttled", retryAfterSeconds: gate.retryAfterSeconds };
      const account = await db
        .selectFrom("identity.account")
        .select("password_hash")
        .where("user_id", "=", s.userId)
        .where("provider_id", "=", "credential")
        .executeTakeFirst();
      const hash = account?.password_hash ?? null;
      if (hash === null || !(await verifyPassword(hash, input.password))) {
        const outcome = throttle.recordFailure(keys);
        if (outcome.accountLockedUntil !== undefined)
          await lockAccount(keys.email, outcome.accountLockedUntil);
        return { ok: false, reason: "invalid_password" };
      }
      throttle.recordSuccess(keys);
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

    async close() {
      await db.destroy();
    },
  };
}
