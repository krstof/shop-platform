// Anmeldung hinter einer eigenen Schnittstelle (Sicherheit 5.2: „damit ein Wechsel möglich bleibt“).
// Außerhalb dieses Moduls weiß niemand, dass Better Auth dahintersteht.
import { ConflictError, ValidationError } from "@shop/kernel";
import { APIError } from "better-auth";
import { z } from "zod";
import {
  CLIENT_IP_HEADER,
  createAuth,
  createAuthPool,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  type Auth,
  type AuthOptions,
} from "./auth.js";
import { checkNewPassword, hashPassword, type PasswordProblem } from "./password.js";

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
      /** Fertige `Set-Cookie`-Zeile für die Antwort. */
      readonly setCookie: string;
    }
  | {
      readonly ok: false;
      /** Immer gleich, egal ob E-Mail unbekannt oder Passwort falsch (Sicherheit 5.2). */
      readonly reason: "invalid_credentials";
    };

export interface ActiveSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
  readonly createdAt: Date;
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

export function createIdentityService(options: AuthOptions): IdentityService {
  const pool = createAuthPool(options);
  const auth: Auth = createAuth(options, pool);

  async function deleteByToken(token: string): Promise<void> {
    await (await auth.$context).internalAdapter.deleteSession(token);
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
      try {
        const { headers, response } = await auth.api.signInEmail({
          body: { email: input.email.trim().toLowerCase(), password: input.password, rememberMe: true },
          headers: requestHeaders(input),
          returnHeaders: true,
        });
        const session = await auth.api.getSession({
          headers: requestHeaders({ cookie: sessionCookieLine(headers).split(";")[0] ?? "" }),
        });
        if (session === null) throw new Error("Neue Sitzung nicht lesbar");
        return {
          ok: true,
          userId: response.user.id,
          sessionId: session.session.id,
          setCookie: sessionCookieLine(headers),
        };
      } catch (error) {
        // Unbekannte E-Mail, falsches Passwort und ungültiges Format sehen gleich aus.
        if (
          error instanceof APIError &&
          (error.status === "UNAUTHORIZED" || error.status === "BAD_REQUEST")
        ) {
          return { ok: false, reason: "invalid_credentials" };
        }
        throw error;
      }
    },

    async getSession(cookieHeader) {
      if (cookieHeader === undefined || !cookieHeader.includes(`${SESSION_COOKIE_NAME}=`)) return undefined;
      const result = await auth.api.getSession({
        headers: requestHeaders({ cookie: cookieHeader }),
        query: { disableRefresh: false },
      });
      if (result === null) return undefined;
      const { session, user } = result;
      // Höchstdauer unabhängig von Aktivität (Better Auth kennt nur das gleitende Ablaufdatum).
      if (Date.now() - session.createdAt.getTime() > SESSION_MAX_AGE_SECONDS * 1000) {
        await deleteByToken(session.token);
        return undefined;
      }
      return {
        userId: user.id,
        sessionId: session.id,
        email: user.email,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      };
    },

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

    async close() {
      await pool.end();
    },
  };
}
