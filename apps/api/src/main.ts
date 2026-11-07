// Startet den Kern-Server. Einstellungen kommen aus der Umgebung (siehe config.ts).
// Anmeldung über das Sitzungs-Cookie (E6 Teil 2), Shop und Rolle über die Kopfzeile Shop-Id und die
// Mitgliedschaft (E6 Teil 3); API-Token folgen später.
import { createIdentityService, createMembershipDirectory } from "@shop/identity";
import { ConfigError, connectDatabase, createLogger } from "@shop/kernel";
import { createShopDirectory } from "@shop/platform";
import { sessionResolver, shopsOfUser } from "./actor.js";
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
  // Eigener kleiner Pool als shop_auth, nur im Modul identity (ADR-008).
  const identity = createIdentityService({
    connectionString: config.SHOP_AUTH_DATABASE_URL,
    secret: config.SHOP_AUTH_SECRET,
    baseUrl: config.SHOP_ALLOWED_ORIGINS[0] ?? `https://admin.${config.SHOP_DOMAIN}`,
    logger,
    onConnectionError: (error) =>
      logger.warn({ err: error }, "Datenbankverbindung (Anmeldung) abgebrochen, wird neu aufgebaut"),
  });
  const memberships = createMembershipDirectory({ database });
  const shops = createShopDirectory({ database });
  const app = await createApi({
    endpoints: allEndpoints({ database, identity, shopsOfUser: shopsOfUser({ memberships, shops }) }),
    resolveActor: sessionResolver({ identity, memberships, shops }),
    logger,
    idempotency: databaseIdempotencyStore(database),
    allowedOrigins: config.SHOP_ALLOWED_ORIGINS,
    ...(config.SHOP_TRUSTED_PROXY === undefined ? {} : { trustedProxy: config.SHOP_TRUSTED_PROXY }),
  });
  app.enableShutdownHooks();
  await app.listen(config.SHOP_API_PORT, config.SHOP_API_HOST);
  logger.info({ port: config.SHOP_API_PORT }, "API gestartet");
  const stop = async () => {
    await app.close();
    await identity.close();
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
