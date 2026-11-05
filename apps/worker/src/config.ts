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
  /** Port des Lebenszeichens /livez, nur auf 127.0.0.1 im Container (Gesundheitscheck). */
  SHOP_WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  /** Ist der Worker so viele Sekunden am Stück krank, beendet er sich; Docker startet ihn neu. 0 = nie. */
  SHOP_WORKER_UNHEALTHY_EXIT_SECONDS: z.coerce.number().int().min(0).max(86_400).default(180),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadWorkerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<WorkerConfig> {
  return loadConfig(workerConfigSchema, env);
}
