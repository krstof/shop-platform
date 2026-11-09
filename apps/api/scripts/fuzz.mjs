// T-12 (kurz): Schemathesis bombardiert die Admin-API mit Zufalls- und Grenzwerten aus der
// OpenAPI-Datei (Sicherheit Kapitel 7). Geprüft: keine 500er, nur dokumentierte Statuscodes,
// Antworten passen zu ihren Schemas, ungültige Eingaben werden abgelehnt.
//
// Aufruf: pnpm test:fuzz (startet Wegwerf-Datenbank, baut nichts selbst; vorher pnpm build).
// Läuft mit echter Datenbank als shop_app; angemeldet ist ein Test-Akteur über die Kopfzeile
// x-test-shop, die es nur in diesem Skript gibt, nie im echten Programm.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdentityService } from "@shop/identity";
import { connectDatabase, createLogger, createSecretBox, uuidv7 } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import { SCOPES } from "@shop/http";
import pg from "pg";
import { createApi } from "../dist/app.js";
import { allEndpoints } from "../dist/endpoints.js";
import { databaseIdempotencyStore } from "../dist/idempotency-store.js";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "../dist/rate-limit.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (adminUrl === undefined) {
  console.error("SHOP_TEST_DATABASE_URL fehlt (Aufruf über pnpm test:fuzz).");
  process.exit(1);
}
const schemathesis = process.env["SHOP_SCHEMATHESIS"] ?? "schemathesis";
const examples = process.env["SHOP_FUZZ_EXAMPLES"] ?? "30";

const dbName = `fuzz_${randomBytes(4).toString("hex")}`;
const tenantA = uuidv7();
const tenantB = uuidv7();
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);
const setupUrl = new URL(adminUrl);
setupUrl.pathname = `/${dbName}`;

/** @type {number | undefined} */
let status;
let app;
let database;
let identity;
try {
  await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
  const setup = new pg.Client({ connectionString: setupUrl.href });
  await setup.connect();
  for (const [id, handle] of [
    [tenantA, "fuzz-a"],
    [tenantB, "fuzz-b"],
  ]) {
    await setup.query(
      `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
       INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
       SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
      [id, handle],
    );
    for (let i = 0; i < 3; i++)
      await setup.query(`INSERT INTO catalog.manufacturer (tenant_id, name) VALUES ($1, $2)`, [
        id,
        `${handle} ${i}`,
      ]);
  }
  // Echte Inhaberin von Shop A: API-Token anlegen prüft die eigene Rolle (E6 Teil 5).
  const ownerId = uuidv7();
  await setup.query(`INSERT INTO identity."user" (id, email) VALUES ($1, 'fuzz@teeladen.example')`, [
    ownerId,
  ]);
  await setup.query(
    `INSERT INTO identity.membership (tenant_id, user_id, role_key) VALUES ($1, $2, 'owner')`,
    [tenantA, ownerId],
  );
  await setup.end();

  database = connectDatabase({
    connectionString: roleUrl(adminUrl, dbName, "shop_app"),
    applicationName: "fuzz",
  });
  // Echtes Anmeldemodul (shop_auth), ohne E-Mail-Versand: „Mitarbeiter einladen“ legt Konten und
  // Codes an und soll dabei bis in die Logik kommen (E6 Teil 7).
  identity = createIdentityService({
    secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
    connectionString: roleUrl(adminUrl, dbName, "shop_auth"),
    secret: randomBytes(32).toString("base64url"),
    baseUrl: "https://admin.localhost",
  });
  const actor = { type: "user", id: ownerId };
  const generous = { limit: 1_000_000, windowMs: 60_000 };
  app = await createApi({
    endpoints: allEndpoints({ database, identity }),
    resolveActor: async ({ headers }) =>
      headers["x-test-shop"] === "a"
        ? // Passwort gerade bestätigt, damit auch „API-Token anlegen“ bis in die Logik kommt.
          { actor, tenantId: tenantA, scopes: new Set(SCOPES), passwordConfirmedAt: new Date() }
        : undefined,
    logger: createLogger({ level: process.env["SHOP_FUZZ_LOG"] ?? "error" }),
    idempotency: databaseIdempotencyStore(database),
    // Die Bremse prüft T-18; hier würde sie die Zufallstests nur ausbremsen.
    rateLimiter: new RateLimiter(
      Object.fromEntries(Object.keys(DEFAULT_RATE_LIMITS).map((k) => [k, generous])),
    ),
  });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address();

  // Asynchron starten: Ein blockierender Aufruf würde den Server in diesem Prozess anhalten.
  const child = spawn(
    schemathesis,
    [
      "run",
      join(repoRoot, "openapi/admin.json"),
      "--url",
      `http://127.0.0.1:${port}`,
      "-H",
      "x-test-shop: a",
      "--checks",
      [
        "not_a_server_error",
        "status_code_conformance",
        "content_type_conformance",
        "response_headers_conformance",
        "response_schema_conformance",
        "negative_data_rejection",
        "unsupported_method",
        // Nicht dabei: missing_required_header. Fehlt If-Match, antworten wir nach RFC 6585 mit 428;
        // Schemathesis erwartet dort 400 oder 422. Fehlende Pflicht-Kopfzeilen prüfen die eigenen Tests.
      ].join(","),
      "--max-examples",
      examples,
      "--seed",
      process.env["SHOP_FUZZ_SEED"] ?? "20261103",
      "--workers",
      "1",
      "--no-color",
    ],
    { stdio: "inherit" },
  );
  status = await new Promise((done) => {
    child.on("error", (e) => {
      console.error(`Schemathesis konnte nicht starten: ${e.message}`);
      done(1);
    });
    child.on("exit", (code) => done(code ?? 1));
  });
} finally {
  await app?.close();
  await identity?.close();
  await database?.destroy();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
}
process.exit(status ?? 1);
