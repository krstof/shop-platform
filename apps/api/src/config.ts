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

export type ApiConfig = Omit<z.output<typeof apiConfigSchema>, "SHOP_ALLOWED_ORIGINS" | "SHOP_MAIL_FROM"> & {
  readonly SHOP_ALLOWED_ORIGINS: readonly string[];
  readonly SHOP_MAIL_FROM: string;
};

export function loadApiConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<ApiConfig> {
  const c = loadConfig(apiConfigSchema, env);
  return Object.freeze({
    ...c,
    SHOP_MAIL_FROM: c.SHOP_MAIL_FROM ?? `Shop-Plattform <no-reply@${c.SHOP_DOMAIN}>`,
    SHOP_ALLOWED_ORIGINS: Object.freeze(
      c.SHOP_ALLOWED_ORIGINS ?? [`https://admin.${c.SHOP_DOMAIN}`, `https://platform.${c.SHOP_DOMAIN}`],
    ),
  });
}
