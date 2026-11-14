// Einstellungen des Kern-Servers (Architektur 7.4). Fehlt etwas oder ist es unsicher, startet er nicht.
import { base64Key, baseConfigSchema, loadConfig, port, postgresUrl, secret } from "@shop/kernel";
import { z } from "zod";

function roleUrl(role: string) {
  return postgresUrl().refine(
    (v) => URL.canParse(v) && decodeURIComponent(new URL(v).username) === role,
    `muss die Rolle ${role} verwenden`,
  );
}

/** Herkunft einer Oberfläche: nur https, nur Schema, Host und Port, ohne Pfad. */
const originSchema = z
  .string()
  .refine((v) => URL.canParse(v) && new URL(v).origin === v, "ist keine Herkunft wie https://admin.localhost")
  .refine((v) => v.startsWith("https://"), "muss mit https:// beginnen");

/** Rechner, zu denen E-Mails unverschlüsselt gehen dürfen: Mailpit im internen Netz oder der eigene Rechner. */
const PLAIN_SMTP_HOSTS = new Set(["mailpit", "localhost", "127.0.0.1", "[::1]"]);

/** Rechner, zu denen der Objektspeicher unverschlüsselt erreichbar sein darf. */
const PLAIN_S3_HOSTS = new Set(["garage", "localhost", "127.0.0.1", "[::1]"]);

/** SMTP-Adresse: smtps:// überall, smtp:// nur zu Mailpit oder zum eigenen Rechner. */
const smtpUrl = z
  .string()
  .refine(
    (v) => URL.canParse(v) && ["smtp:", "smtps:"].includes(new URL(v).protocol),
    "muss mit smtp:// oder smtps:// beginnen",
  )
  .refine(
    (v) => !URL.canParse(v) || new URL(v).protocol !== "smtp:" || PLAIN_SMTP_HOSTS.has(new URL(v).hostname),
    "unverschlüsselt (smtp://) nur zu Mailpit oder localhost, sonst smtps://",
  );

export const apiConfigSchema = baseConfigSchema.extend({
  /** Verbindung als Rolle shop_app (nie als Eigentümer- oder Verwaltungsrolle). */
  SHOP_APP_DATABASE_URL: roleUrl("shop_app"),
  /** Verbindung des Anmeldemoduls (ADR-008). Nur sie sieht Passwort-Hashes und Sitzungen. */
  SHOP_AUTH_DATABASE_URL: roleUrl("shop_auth"),
  /** Plattform-Verwaltung (M1): Shops anlegen und sperren. Kleiner Pool, nur im Modul platform. */
  SHOP_PLATFORM_DATABASE_URL: roleUrl("shop_platform"),
  /** Geheimnis zum Signieren der Sitzungs-Cookies (Sicherheit 5.10). */
  SHOP_AUTH_SECRET: secret(32),
  /**
   * Hauptschlüssel für TOTP-Geheimnisse und Ersatzcodes (Envelope Encryption, Sicherheit 5.10).
   * Für einen Schlüsselwechsel kommt SHOP_MASTER_KEY_V2 dazu; V1 bleibt, bis alles umgeschlüsselt ist.
   */
  SHOP_MASTER_KEY_V1: base64Key(32),
  SHOP_MASTER_KEY_V2: base64Key(32).optional(),
  /**
   * E-Mail-Versand (E6 Teil 6). Heute immer Mailpit (fängt alles ab), etwa smtp://mailpit:1025.
   * Mit dem Modul notifications (E16) zieht der Versand in den Worker um.
   */
  SHOP_SMTP_URL: smtpUrl,
  /** Absender der E-Mails. Standard: Shop-Plattform <no-reply@SHOP_DOMAIN>. */
  SHOP_MAIL_FROM: z
    .string()
    .max(200)
    .refine((v) => !/[\r\n]/.test(v), "darf keinen Zeilenumbruch enthalten")
    .optional(),
  /**
   * Objektspeicher für Bilder (M2 Teil 2, S3-Schnittstelle, lokal Garage). Adresse wie
   * http://garage:3900; unverschlüsselt nur im internen Netz oder zum eigenen Rechner.
   */
  SHOP_S3_ENDPOINT: z
    .string()
    .refine(
      (v) => URL.canParse(v) && ["http:", "https:"].includes(new URL(v).protocol),
      "ist keine http(s)-Adresse",
    )
    .refine(
      (v) => !URL.canParse(v) || new URL(v).protocol === "https:" || PLAIN_S3_HOSTS.has(new URL(v).hostname),
      "unverschlüsselt (http://) nur zu garage oder localhost, sonst https://",
    ),
  SHOP_S3_REGION: z.string().min(1).max(64).default("garage"),
  SHOP_S3_ACCESS_KEY_ID: z.string().min(16).max(128),
  SHOP_S3_SECRET_ACCESS_KEY: secret(32),
  SHOP_S3_BUCKET_PUBLIC: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, "ist kein gültiger Bereichsname"),
  SHOP_S3_BUCKET_PRIVATE: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, "ist kein gültiger Bereichsname"),
  /** Öffentliche Adresse der Bilder. Standard: https://media.<SHOP_DOMAIN>. */
  SHOP_MEDIA_BASE_URL: originSchema.optional(),
  /**
   * KI-Assistent (Welle 2): Schlüssel für die Messages-API von Anthropic. Ohne Schlüssel meldet der
   * Assistent im Backoffice „nicht eingerichtet“. Der Schlüssel erscheint nie im Protokoll.
   */
  SHOP_ASSISTANT_API_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,300}$/, "hat nicht die Form eines API-Schlüssels")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Modell des Assistenten, Standard claude-sonnet-5-5. */
  SHOP_ASSISTANT_MODEL: z
    .string()
    .regex(/^[a-z0-9.-]{3,80}$/)
    .default("claude-sonnet-5-5"),
  /**
   * Ausgang zum Sprachmodell. Die API hat kein Internet; auf dem Server führt Caddy genau diese
   * eine Verbindung nach außen (http://10.213.17.200:8095). Standard: https://api.anthropic.com.
   */
  SHOP_ASSISTANT_BASE_URL: z
    .string()
    .refine(
      (v) => URL.canParse(v) && ["http:", "https:"].includes(new URL(v).protocol),
      "ist keine http(s)-Adresse",
    )
    .optional(),
  /** Antworten des Assistenten je Shop und Tag (Kostenbremse). */
  SHOP_ASSISTANT_DAILY_LIMIT: z.coerce.number().int().min(0).max(100_000).default(300),
  SHOP_API_HOST: z.union([z.ipv4(), z.ipv6()]).default("127.0.0.1"),
  SHOP_API_PORT: port().default(3000),
  /** Adresse des Reverse Proxy (Caddy). Nur er darf die Absenderadresse weitergeben. */
  SHOP_TRUSTED_PROXY: z.union([z.ipv4(), z.ipv6()]).optional(),
  /**
   * Oberflächen, die ändernde Anfragen schicken dürfen (Herkunftsprüfung gegen CSRF, Sicherheit 5.5),
   * mit Komma getrennt. Standard: Backoffice und Plattform-Verwaltung unter SHOP_DOMAIN.
   */
  SHOP_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    )
    .pipe(z.array(originSchema).min(1).optional()),
});

export type ApiConfig = Omit<
  z.output<typeof apiConfigSchema>,
  "SHOP_ALLOWED_ORIGINS" | "SHOP_MAIL_FROM" | "SHOP_MEDIA_BASE_URL"
> & {
  readonly SHOP_ALLOWED_ORIGINS: readonly string[];
  readonly SHOP_MAIL_FROM: string;
  readonly SHOP_MEDIA_BASE_URL: string;
};

export function loadApiConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<ApiConfig> {
  const c = loadConfig(apiConfigSchema, env);
  return Object.freeze({
    ...c,
    SHOP_MAIL_FROM: c.SHOP_MAIL_FROM ?? `Shop-Plattform <no-reply@${c.SHOP_DOMAIN}>`,
    SHOP_MEDIA_BASE_URL: c.SHOP_MEDIA_BASE_URL ?? `https://media.${c.SHOP_DOMAIN}`,
    SHOP_ALLOWED_ORIGINS: Object.freeze(
      c.SHOP_ALLOWED_ORIGINS ?? [`https://admin.${c.SHOP_DOMAIN}`, `https://platform.${c.SHOP_DOMAIN}`],
    ),
  });
}
