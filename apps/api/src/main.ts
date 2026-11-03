// Startet den Kern-Server. Einstellungen kommen aus der Umgebung (siehe config.ts).
// Die Anmeldung (Sitzung, API-Token) kommt mit E6; bis dahin lehnt der Wächter jede
// geschützte Anfrage mit 401 ab.
import { ConfigError, connectDatabase, createLogger } from "@shop/kernel";
import { nobodyResolver } from "./actor.js";
import { createApi } from "./app.js";
import { loadApiConfig } from "./config.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";
import { allEndpoints } from "./endpoints.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger({ level: config.SHOP_LOG_LEVEL, name: "api" });
  const database = connectDatabase<unknown>({
    connectionString: config.SHOP_APP_DATABASE_URL,
    applicationName: "api",
    onConnectionError: (error) =>
      logger.warn({ err: error }, "Datenbankverbindung abgebrochen, wird neu aufgebaut"),
  });
  const app = await createApi({
    endpoints: allEndpoints({ database }),
    resolveActor: nobodyResolver,
    logger,
    idempotency: databaseIdempotencyStore(database),
    ...(config.SHOP_TRUSTED_PROXY === undefined ? {} : { trustedProxy: config.SHOP_TRUSTED_PROXY }),
  });
  app.enableShutdownHooks();
  await app.listen(config.SHOP_API_PORT, config.SHOP_API_HOST);
  logger.info({ port: config.SHOP_API_PORT }, "API gestartet");
  const stop = async () => {
    await app.close();
    await database.destroy();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((error: unknown) => {
  // Konfigurationsfehler nennen nur Namen, nie Werte.
  console.error(error instanceof ConfigError ? error.message : "API konnte nicht starten.");
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
});
