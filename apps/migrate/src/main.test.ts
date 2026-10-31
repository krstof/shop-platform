import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main, migrateConfigSchema, rolePasswordsFrom } from "./main.js";

const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
const required = process.env["SHOP_REQUIRE_DB_TESTS"] === "true";
if (required && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

describe("Einstellungen des Dienstes migrate", () => {
  it("startet nicht ohne Datenbankadresse und nennt keine Werte", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main({ SHOP_ENV: "local", SHOP_DB_PASSWORD_APP: "zu-kurz" })).toBe(1);
    const text = spy.mock.calls.flat().join("\n");
    expect(text).toContain("SHOP_MIGRATE_DATABASE_URL: fehlt");
    expect(text).toContain("SHOP_DB_PASSWORD_APP: zu kurz");
    expect(text).not.toContain("zu-kurz");
    spy.mockRestore();
  });

  it("verlangt außerhalb von local TLS für die Datenbank", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main({ SHOP_ENV: "production", SHOP_MIGRATE_DATABASE_URL: "postgres://x@db/shop" })).toBe(1);
    expect(spy.mock.calls.flat().join("\n")).toContain("sslmode=verify-full");
    spy.mockRestore();
  });

  it("ordnet die Passwörter den Rollen zu und lässt fehlende weg", () => {
    const config = migrateConfigSchema.parse({
      SHOP_ENV: "local",
      SHOP_MIGRATE_DATABASE_URL: "postgres://x@db/shop",
      SHOP_DB_PASSWORD_APP: "a".repeat(20) + "bcdefghijklmn",
    });
    expect(Object.keys(rolePasswordsFrom(config))).toEqual(["shop_app"]);
  });
});

describe.skipIf(adminUrl === undefined)("Dienst migrate mit echter Datenbank", () => {
  const name = `migrate_app_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("legt die Datenbank an, migriert sie und läuft danach ohne Änderung", async () => {
    await admin.connect();
    const url = new URL(adminUrl ?? "");
    url.pathname = `/${name}`;
    const env = {
      SHOP_ENV: "test",
      SHOP_LOG_LEVEL: "warn",
      SHOP_MIGRATE_DATABASE_URL: url.href,
      SHOP_MIGRATE_CREATE_DATABASE: "true",
    };
    expect(await main(env)).toBe(0);
    expect(await main(env)).toBe(0);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_database WHERE datname = $1`,
      [name],
    );
    expect(rows.rows[0]?.n).toBe("1");
  }, 60_000);
});
