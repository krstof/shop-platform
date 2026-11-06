// Better Auth, eng eingestellt (Sicherheit 5.2, ADR-008, Anforderungen 6.5).
//
// Grundsätze:
// - Läuft mit einem eigenen kleinen Verbindungspool als Rolle shop_auth. Nur dieser Pool sieht
//   Passwort-Hashes, Sitzungen und Einmalcodes. Er verlässt das Modul identity nie.
// - Nur E-Mail und Passwort. Keine Selbst-Registrierung (Händler legt die Plattform an),
//   keine fremden Anmeldedienste, keine weiteren Plugins.
// - Der HTTP-Teil von Better Auth wird nicht nach außen gegeben. Das Modul ruft Better Auth
//   nur auf dem Server auf (`auth.api.*`); eigene Endpunkte mit eigener Bremse folgen in E6 Teil 2.
//   So greifen frühere Lücken über Pfad-Schreibweisen (CVE-2025-71399) bei uns gar nicht.
// - Passwörter mit Argon2id (password.ts), Sitzungs-Token nur als Hash (hashed-session-adapter.ts).
import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { Kysely, PostgresDialect } from "kysely";
import type { Logger } from "@shop/kernel";
import pg from "pg";
import { withHashedSessionTokens } from "./hashed-session-adapter.js";
import { hashPassword, verifyPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password.js";

/** Name des Sitzungs-Cookies. `__Host-` lässt den Browser Secure, Pfad `/` und keine Domain erzwingen. */
export const SESSION_COOKIE_NAME = "__Host-shop_session";

/**
 * Kopfzeile, über die das Modul Better Auth die Absenderadresse mitgibt. Sie wird nur auf dem
 * Server gesetzt (aus der von Fastify geprüften Adresse), nie aus einer Anfrage übernommen.
 */
export const CLIENT_IP_HEADER = "x-shop-client-ip";

/** Backoffice (Sicherheit 5.2): 12 Stunden ohne Aktivität, höchstens 7 Tage. */
export const SESSION_IDLE_SECONDS = 12 * 60 * 60;
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** So oft wird das Ablaufdatum einer benutzten Sitzung nach vorn geschoben. */
export const SESSION_REFRESH_SECONDS = 15 * 60;

export interface AuthOptions {
  /** Verbindung als Rolle shop_auth. */
  readonly connectionString: string;
  /** Geheimnis zum Signieren der Cookies (mindestens 32 Zeichen, aus SHOP_AUTH_SECRET). */
  readonly secret: string;
  /** Öffentliche Adresse des Backoffice, z. B. https://admin.localhost. */
  readonly baseUrl: string;
  readonly maxConnections?: number;
  /** Meldungen von Better Auth landen hier (nur der Text, keine Zusatzdaten wie E-Mail-Adressen). */
  readonly logger?: Logger;
  readonly onConnectionError?: (error: Error) => void;
}

export function createAuthPool(options: AuthOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 5,
    application_name: "identity",
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  pool.on("error", (error) => options.onConnectionError?.(error));
  return pool;
}

export function createAuth(options: AuthOptions, pool: pg.Pool) {
  if (options.secret.length < 32) throw new Error("Geheimnis für die Anmeldung ist zu kurz");
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) }).withSchema("identity");
  const adapter = kyselyAdapter(db, { type: "postgres" });

  return betterAuth({
    appName: "Shop-Plattform",
    baseURL: options.baseUrl,
    basePath: "/auth/v1",
    secret: options.secret,
    database: (opts: BetterAuthOptions) => withHashedSessionTokens(adapter(opts)),
    telemetry: { enabled: false },
    logger:
      options.logger === undefined
        ? { disabled: true }
        : {
            level: "warn",
            log: (level, message) => options.logger?.[level]({ source: "better-auth" }, message),
          },
    trustedOrigins: [new URL(options.baseUrl).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Erst mit Einladungen und „Passwort vergessen“ (E6 Teil 3) eingeschaltet.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // Kein Sitzungs-Cache im Cookie: Jede Anfrage prüft die Datenbank, damit Abmelden und
      // Sperren sofort wirken (und wegen CVE-2026-67337 zur Umgehung der Zwei-Faktor-Prüfung).
      cookieCache: { enabled: false },
      freshAge: 15 * 60,
      fields: {
        userId: "user_id",
        token: "token_hash",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    user: {
      fields: {
        emailVerified: "email_verified",
        image: "image_url",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        password: "password_hash",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // Keine fremden Anmeldedienste, also auch keine automatische Kontoverknüpfung.
      accountLinking: { enabled: false },
    },
    // Eigene Bremse in E6 Teil 2 (je Konto und je Netz, Sperre in identity.user.locked_until).
    rateLimit: { enabled: false },
    advanced: {
      // Die Datenbank vergibt UUIDv7 (DEFAULT uuidv7()).
      database: { generateId: false },
      // Sonst setzt Better Auth bei https „__Secure-“ vor unseren Namen.
      useSecureCookies: false,
      cookies: {
        session_token: {
          name: SESSION_COOKIE_NAME,
          attributes: { secure: true, httpOnly: true, sameSite: "lax", path: "/" },
        },
      },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], ipv6Subnet: 64 },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
