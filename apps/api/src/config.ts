// Einstellungen des Kern-Servers (Architektur 7.4). Fehlt etwas oder ist es unsicher, startet er nicht.
import { baseConfigSchema, loadConfig, port, postgresUrl } from "@shop/kernel";
import { z } from "zod";

export const apiConfigSchema = baseConfigSchema.extend({
  /** Verbindung als Rolle shop_app (nie als Eigentümer- oder Verwaltungsrolle). */
  SHOP_APP_DATABASE_URL: postgresUrl().refine(
    (v) => URL.canParse(v) && decodeURIComponent(new URL(v).username) === "shop_app",
    "muss die Rolle shop_app verwenden",
  ),
  SHOP_API_HOST: z.union([z.ipv4(), z.ipv6()]).default("127.0.0.1"),
  SHOP_API_PORT: port().default(3000),
  /** Adresse des Reverse Proxy (Caddy). Nur er darf die Absenderadresse weitergeben. */
  SHOP_TRUSTED_PROXY: z.union([z.ipv4(), z.ipv6()]).optional(),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function loadApiConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<ApiConfig> {
  return loadConfig(apiConfigSchema, env);
}
