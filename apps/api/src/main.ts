// Startet den Kern-Server. Einstellungen kommen aus der Umgebung (siehe config.ts).
// Anmeldung über das Sitzungs-Cookie (E6 Teil 2), Shop und Rolle über die Kopfzeile Shop-Id und die
// Mitgliedschaft (E6 Teil 3), Betreiber mit Zwei-Faktor (E6 Teil 4), API-Token (E6 Teil 5),
// „Passwort vergessen“ mit E-Mail an Mailpit (E6 Teil 6), Mitarbeiter einladen und entfernen (E6 Teil 7).
import { anthropicModel } from "@shop/ai";
import {
  createApiTokenService,
  createIdentityService,
  createMemberService,
  createMembershipDirectory,
} from "@shop/identity";
import { ConfigError, connectDatabase, createLogger, createSecretBox, masterKeysFromEnv } from "@shop/kernel";
import { createOperatorDirectory, createShopAdministration, createShopDirectory } from "@shop/platform";
import { apiTokenResolver, requestResolver, sessionResolver, shopsOfUser } from "./actor.js";
import { createApi } from "./app.js";
import { loadApiConfig } from "./config.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";
import { createSmtpMailSender } from "./mail.js";
import { allEndpoints } from "./endpoints.js";
import { mediaFromConfig } from "./media.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger({ level: config.SHOP_LOG_LEVEL, name: "api" });
  const database = connectDatabase<unknown>({
    connectionString: config.SHOP_APP_DATABASE_URL,
    applicationName: "api",
    onConnectionError: (error) =>
      logger.warn({ err: error }, "Datenbankverbindung abgebrochen, wird neu aufgebaut"),
  });
  const operators = createOperatorDirectory({ database });
  // Eigener kleiner Pool als shop_platform, nur für die Plattform-Verwaltung (M1).
  const platformDatabase = connectDatabase<unknown>({
    connectionString: config.SHOP_PLATFORM_DATABASE_URL,
    applicationName: "api-platform",
    maxConnections: 2,
    onConnectionError: (error) =>
      logger.warn({ err: error }, "Datenbankverbindung (Plattform) abgebrochen, wird neu aufgebaut"),
  });
  const mailer = createSmtpMailSender({ url: config.SHOP_SMTP_URL, from: config.SHOP_MAIL_FROM });
  // Eigener kleiner Pool als shop_auth, nur im Modul identity (ADR-008).
  const identity = createIdentityService({
    secretBox: createSecretBox(
      masterKeysFromEnv({
        SHOP_MASTER_KEY_V1: config.SHOP_MASTER_KEY_V1,
        SHOP_MASTER_KEY_V2: config.SHOP_MASTER_KEY_V2,
      }),
    ),
    // Betreiberkonten: 1 Stunde ohne Aktivität, höchstens 12 Stunden (Sicherheit 5.2).
    sessionKindOf: async (userId) =>
      (await operators.findOperator(userId)) === undefined ? "standard" : "operator",
    mailer,
    connectionString: config.SHOP_AUTH_DATABASE_URL,
    secret: config.SHOP_AUTH_SECRET,
    baseUrl: config.SHOP_ALLOWED_ORIGINS[0] ?? `https://admin.${config.SHOP_DOMAIN}`,
    logger,
    onConnectionError: (error) =>
      logger.warn({ err: error }, "Datenbankverbindung (Anmeldung) abgebrochen, wird neu aufgebaut"),
  });
  const memberships = createMembershipDirectory({ database });
  const shops = createShopDirectory({ database });
  const tokens = createApiTokenService({ database, memberships });
  const members = createMemberService({
    database,
    identity,
    mailer,
    baseUrl: config.SHOP_ALLOWED_ORIGINS[0] ?? `https://admin.${config.SHOP_DOMAIN}`,
    shopName: async (tenantId) => (await shops.getShops([tenantId]))[0]?.name,
    logger,
  });
  const app = await createApi({
    endpoints: allEndpoints({
      database,
      identity,
      operators,
      tokens,
      members,
      platformShops: createShopAdministration({ database: platformDatabase }),
      shopsOfUser: shopsOfUser({ memberships, shops }),
      media: mediaFromConfig(config, database),
      mailer,
      storefrontBaseUrl: config.SHOP_STOREFRONT_BASE_URL,
      logger,
      assistantModel:
        config.SHOP_ASSISTANT_API_KEY === undefined
          ? undefined
          : anthropicModel({
              apiKey: config.SHOP_ASSISTANT_API_KEY,
              model: config.SHOP_ASSISTANT_MODEL,
              ...(config.SHOP_ASSISTANT_BASE_URL === undefined
                ? {}
                : { baseUrl: config.SHOP_ASSISTANT_BASE_URL }),
            }),
      assistantDailyLimit: config.SHOP_ASSISTANT_DAILY_LIMIT,
    }),
    resolveActor: requestResolver(
      sessionResolver({ identity, memberships, shops, operators }),
      apiTokenResolver({ tokens, shops }),
    ),
    logger,
    idempotency: databaseIdempotencyStore(database),
    allowedOrigins: config.SHOP_ALLOWED_ORIGINS,
    storeShops: async (handle) => (await shops.findActiveByHandle(handle))?.id,
    ...(config.SHOP_TRUSTED_PROXY === undefined ? {} : { trustedProxy: config.SHOP_TRUSTED_PROXY }),
  });
  app.enableShutdownHooks();
  await app.listen(config.SHOP_API_PORT, config.SHOP_API_HOST);
  logger.info({ port: config.SHOP_API_PORT }, "API gestartet");
  const stop = async () => {
    await app.close();
    await identity.close();
    mailer.close();
    await database.destroy();
    await platformDatabase.destroy();
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
