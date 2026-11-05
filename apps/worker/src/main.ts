// Startet den Dienst worker. Einstellungen kommen aus der Umgebung (siehe config.ts).
import { ConfigError, connectDatabase, createLogger } from "@shop/kernel";
import { loadWorkerConfig } from "./config.js";
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
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.stop();
    await appDatabase.destroy();
    await relayDatabase.destroy();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((error: unknown) => {
  // Konfigurationsfehler nennen nur Namen, nie Werte.
  console.error(error instanceof ConfigError ? error.message : "Worker konnte nicht starten.");
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
});
