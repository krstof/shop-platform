// Testdaten (MVP-Etappen M1 und M2): legt die Testshops Teeladen und Modeladen mit je einem
// Inhaberkonto an, dazu Kategorien und Produkte mit Preis und Bestand (seed-catalog.ts).
// Läuft im Container der API (`pnpm dev:seed`) mit denselben Einstellungen wie die API.
// Mehrfach ausführen schadet nicht: Was es schon gibt, bleibt unverändert.
//
// Passwort der Inhaberkonten: SHOP_SEED_PASSWORD, sonst je Konto ein zufälliges, das nur hier einmal
// ausgegeben wird. Nur für Testsysteme gedacht; in Produktion verweigert der Befehl die Arbeit.
import { randomBytes } from "node:crypto";
import { createIdentityService, createMemberService } from "@shop/identity";
import {
  ConfigError,
  ConflictError,
  connectDatabase,
  createSecretBox,
  masterKeysFromEnv,
} from "@shop/kernel";
import { addOperatorForTestData, createShopAdministration } from "@shop/platform";
import { loadApiConfig } from "./config.js";
import { allEndpoints } from "./endpoints.js";
import { mediaFromConfig } from "./media.js";
import { seedCatalog } from "./seed-catalog.js";
import { seedOrders } from "./seed-orders.js";

const SEED_SHOPS = [
  { handle: "teeladen", name: "Teeladen", ownerEmail: "inhaberin@teeladen.example", ownerName: "Ina Tee" },
  { handle: "modeladen", name: "Modeladen", ownerEmail: "inhaber@modeladen.example", ownerName: "Mo Mode" },
] as const;

/** Betreiberkonto für die Plattform-Verwaltung (M8). Zwei-Faktor richtet es beim ersten Anmelden ein. */
const SEED_OPERATOR = { email: "maletzke@gmail.com", name: "Betrieb" } as const;

async function main(): Promise<void> {
  const config = loadApiConfig();
  if (config.SHOP_ENV === "production")
    throw new ConfigError(["SHOP_ENV: Testdaten gibt es nicht in Produktion."]);
  const fixedPassword = process.env["SHOP_SEED_PASSWORD"];
  // Testserver: nur der Prüfwert des Testpassworts (infra/testserver/test-login.env), nie das Passwort.
  const fixedHash = process.env["SHOP_SEED_PASSWORD_HASH"];
  const setFixed = async (email: string) => {
    if (fixedHash !== undefined) await identity.setPasswordForTestData({ email, passwordHash: fixedHash });
    else if (fixedPassword !== undefined)
      await identity.setPasswordForTestData({ email, newPassword: fixedPassword });
  };
  const fixedNote = fixedHash !== undefined ? "Testpasswort des Servers" : "Passwort aus SHOP_SEED_PASSWORD";
  const database = connectDatabase<unknown>({
    connectionString: config.SHOP_APP_DATABASE_URL,
    applicationName: "seed",
    maxConnections: 2,
  });
  const platformDatabase = connectDatabase<unknown>({
    connectionString: config.SHOP_PLATFORM_DATABASE_URL,
    applicationName: "seed-platform",
    maxConnections: 2,
  });
  const identity = createIdentityService({
    secretBox: createSecretBox(
      masterKeysFromEnv({
        SHOP_MASTER_KEY_V1: config.SHOP_MASTER_KEY_V1,
        SHOP_MASTER_KEY_V2: config.SHOP_MASTER_KEY_V2,
      }),
    ),
    connectionString: config.SHOP_AUTH_DATABASE_URL,
    secret: config.SHOP_AUTH_SECRET,
    baseUrl: config.SHOP_ALLOWED_ORIGINS[0] ?? `https://admin.${config.SHOP_DOMAIN}`,
  });
  const shops = createShopAdministration({ database: platformDatabase });
  const members = createMemberService({ database, identity, baseUrl: `https://admin.${config.SHOP_DOMAIN}` });
  try {
    const existing = new Set((await shops.list({ limit: 100 })).map((s) => s.handle));
    for (const seed of SEED_SHOPS) {
      if (existing.has(seed.handle)) {
        // Mit SHOP_SEED_PASSWORD (Testserver) folgt das Inhaberkonto immer diesem Passwort, damit ein
        // neues Passwort in GitHub auch für die Anmeldung im Backoffice gilt.
        await setFixed(seed.ownerEmail);
        const fixed = fixedPassword !== undefined || fixedHash !== undefined;
        console.log(
          `${seed.name}: gibt es schon, bleibt unverändert` + (fixed ? ` (${fixedNote} gesetzt).` : "."),
        );
        continue;
      }
      const created = await shops.create({
        handle: seed.handle,
        name: seed.name,
        ownerEmail: seed.ownerEmail,
      });
      if (!created.ok) throw new Error(`${seed.name}: Kurzname schon vergeben`);
      const password = fixedPassword ?? `Test-${randomBytes(12).toString("base64url")}`;
      const { userId } = await identity.createUser({
        email: seed.ownerEmail,
        password,
        name: seed.ownerName,
      });
      await members.addOwner({ tenantId: created.shop.id, userId });
      if (fixedHash !== undefined) await setFixed(seed.ownerEmail);
      const shown = fixedPassword === undefined && fixedHash === undefined;
      console.log(
        `${seed.name}: angelegt. Inhaberkonto ${seed.ownerEmail}` +
          (shown ? `, Passwort ${password}` : `, ${fixedNote}`),
      );
    }
    // Betreiberkonto (M8): Konto anlegen, falls neu, und als Inhaber der Plattform eintragen.
    let operatorId: string;
    let operatorPassword: string | undefined;
    try {
      operatorPassword = fixedPassword ?? `Test-${randomBytes(12).toString("base64url")}`;
      operatorId = (
        await identity.createUser({
          email: SEED_OPERATOR.email,
          password: operatorPassword,
          name: SEED_OPERATOR.name,
        })
      ).userId;
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      operatorPassword = undefined;
      const existingUser = await identity.prepareInvitee({ email: SEED_OPERATOR.email, locale: "de" });
      if (existingUser === undefined) throw new Error("Betreiberkonto nicht lesbar", { cause: error });
      operatorId = existingUser.userId;
    }
    await addOperatorForTestData(platformDatabase, { userId: operatorId, role: "owner" });
    // Eigenes Passwort für die Plattform-Verwaltung (Kristof 22.11.2026), unabhängig von den
    // Inhaberkonten: Prüfwert aus SHOP_SEED_OPERATOR_PASSWORD_HASH (infra/testserver/test-login.env).
    const operatorHash = process.env["SHOP_SEED_OPERATOR_PASSWORD_HASH"];
    if (operatorHash !== undefined)
      await identity.setPasswordForTestData({ email: SEED_OPERATOR.email, passwordHash: operatorHash });
    else await setFixed(SEED_OPERATOR.email);
    const showOperator =
      operatorPassword !== undefined && fixedPassword === undefined && fixedHash === undefined;
    console.log(
      `Plattform-Verwaltung: Betreiberkonto ${SEED_OPERATOR.email}` +
        (operatorHash !== undefined
          ? ", eigenes Testpasswort der Plattform-Verwaltung"
          : showOperator
            ? `, Passwort ${operatorPassword}`
            : fixedPassword !== undefined || fixedHash !== undefined
              ? `, ${fixedNote}`
              : ", gibt es schon") +
        ". Zwei-Faktor wird beim ersten Öffnen eingerichtet.",
    );
    // Produkte (M2): nur in Shops, die noch keine haben.
    const endpoints = allEndpoints({ database, identity, members, media: mediaFromConfig(config, database) });
    for (const shop of await shops.list({ limit: 100 })) {
      const seed = SEED_SHOPS.find((s) => s.handle === shop.handle);
      if (seed === undefined) continue;
      const result = await seedCatalog({ database, endpoints, tenantId: shop.id, handle: shop.handle });
      console.log(`${seed.name}: ${result}.`);
      // Bestellungen und Nachrichten (21.11.2026), damit Listen und Kennzahlen nicht leer sind.
      const sales = await seedOrders({ database, endpoints, tenantId: shop.id, handle: shop.handle });
      if (sales !== "") console.log(`${seed.name}: ${sales}.`);
    }
  } finally {
    await identity.close();
    await database.destroy();
    await platformDatabase.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : "Testdaten konnten nicht angelegt werden.");
  if (!(error instanceof ConfigError)) console.error(error);
  process.exit(1);
});
