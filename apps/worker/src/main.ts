// Startet den Dienst worker. Einstellungen kommen aus der Umgebung (siehe config.ts).
import { ConfigError, connectDatabase, createLogger } from "@shop/kernel";
import { loadWorkerConfig } from "./config.js";
import { startHealthServer, watchUnhealthy } from "./health.js";
import { allSubscribers } from "./subscribers.js";
import { startWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger({ level: config.SHOP_LOG_LEVEL, name: "worker" });
  const onConnectionError = (error: Error) =>
    logger.warn({ err: error }, "Datenbankverbindung abgebrochen, wird neu aufgebaut");
  const appDatabase = connectDatabase<unknown>({
    connectionString: config.SHOP_APP_DATABASE_URL,
    applicationName: "worker",
    onConnectionError,
  });
  const relayDatabase = connectDatabase<unknown>({
    connectionString: config.SHOP_RELAY_DATABASE_URL,
    applicationName: "worker-relay",
    maxConnections: 3,
    onConnectionError,
  });
  const worker = await startWorker({
    appDatabase,
    relayDatabase,
    queueConnectionString: config.SHOP_RELAY_DATABASE_URL,
    subscribers: allSubscribers(),
    logger,
    outboxRetentionDays: config.SHOP_OUTBOX_RETENTION_DAYS,
  });
  const health = await startHealthServer({
    port: config.SHOP_WORKER_HEALTH_PORT,
    isHealthy: () => worker.isHealthy(),
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    watchdog?.stop();
    await worker.stop();
    await health.close();
    await appDatabase.destroy();
    await relayDatabase.destroy();
  };
  // Selbst-Neustart bei anhaltender Krankheit: beenden mit Code 1, Docker startet neu.
  const exitAfter = config.SHOP_WORKER_UNHEALTHY_EXIT_SECONDS;
  const watchdog =
    exitAfter === 0
      ? undefined
      : watchUnhealthy({
          isHealthy: () => worker.isHealthy(),
          afterMs: exitAfter * 1000,
          onUnhealthy: (ms) => {
            logger.error(
              { unhealthyForSeconds: Math.round(ms / 1000) },
              "Worker zu lange krank, beendet sich für einen Neustart",
            );
            // Höchstens 20 s geordnet anhalten, dann auf jeden Fall beenden.
            setTimeout(() => process.exit(1), 20_000).unref();
            void stop().finally(() => process.exit(1));
          },
        });
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((error: unknown) => {
  // Konfigurationsfehler nennen nur Namen, nie Werte.
  console.error(error instanceof ConfigError ? error.message : "Worker konnte nicht starten.");
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
});
