// Einstellungen des Dienstes worker (Architektur 7.4). Fehlt etwas oder ist es unsicher, startet er nicht.
import { baseConfigSchema, loadConfig, postgresUrl } from "@shop/kernel";
import { z } from "zod";

function roleUrl(role: string) {
  return postgresUrl().refine(
    (v) => URL.canParse(v) && decodeURIComponent(new URL(v).username) === role,
    `muss die Rolle ${role} verwenden`,
  );
}

export const workerConfigSchema = baseConfigSchema.extend({
  /** Verarbeitung der Ereignisse: immer für genau einen Shop, als shop_app. */
  SHOP_APP_DATABASE_URL: roleUrl("shop_app"),
  /** Outbox lesen, Warteschlange, Aufräumen: über alle Shops, als shop_relay (nichts sonst). */
  SHOP_RELAY_DATABASE_URL: roleUrl("shop_relay"),
  /** Veröffentlichte Ereignisse so viele Tage in der Outbox aufheben (ADR-007). */
  SHOP_OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadWorkerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<WorkerConfig> {
  return loadConfig(workerConfigSchema, env);
}
