import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  base64Key,
  baseConfigSchema,
  ConfigError,
  flag,
  loadConfig,
  port,
  postgresUrl,
  secret,
} from "./config.js";

const schema = baseConfigSchema.extend({
  SHOP_API_PORT: port(),
  SHOP_APP_DATABASE_URL: postgresUrl(),
  SHOP_SESSION_SECRET: secret(),
  SHOP_MASTER_KEY_V1: base64Key(32),
  SHOP_FEATURE_X: flag().default(false),
});

const KEY = Buffer.alloc(32, 7).toString("base64");
const SECRET = randomBytes(36).toString("base64url");

const good = {
  SHOP_ENV: "local",
  SHOP_DOMAIN: "localhost",
  SHOP_API_PORT: "3000",
  SHOP_APP_DATABASE_URL: "postgres://shop_app:pw@db:5432/shop",
  SHOP_SESSION_SECRET: SECRET,
  SHOP_MASTER_KEY_V1: KEY,
};

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(schema, env);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe("loadConfig", () => {
  it("liefert geprüfte, eingefrorene Einstellungen mit Standardwerten", () => {
    const c = loadConfig(schema, { ...good, UNRELATED: "x" });
    expect(c.SHOP_API_PORT).toBe(3000);
    expect(c.SHOP_LOG_LEVEL).toBe("info");
    expect(c.SHOP_FEATURE_X).toBe(false);
    expect(Object.isFrozen(c)).toBe(true);
    expect(c).not.toHaveProperty("UNRELATED");
  });

  it("nennt alle fehlenden Werte auf einmal, leere Werte gelten als fehlend", () => {
    const p = problemsOf({ SHOP_ENV: "local", SHOP_DOMAIN: "localhost", SHOP_SESSION_SECRET: "  " });
    expect(p).toEqual(
      expect.arrayContaining([
        "SHOP_API_PORT: fehlt",
        "SHOP_APP_DATABASE_URL: fehlt",
        "SHOP_SESSION_SECRET: fehlt",
        "SHOP_MASTER_KEY_V1: fehlt",
      ]),
    );
  });

  it("lehnt unsichere Geheimnisse ab", () => {
    expect(problemsOf({ ...good, SHOP_SESSION_SECRET: "kurz" })[0]).toMatch(/SHOP_SESSION_SECRET: zu kurz/);
    expect(problemsOf({ ...good, SHOP_SESSION_SECRET: "__SECRET__" }).join()).toMatch(/Platzhalter/);
    expect(problemsOf({ ...good, SHOP_SESSION_SECRET: "a".repeat(40) }).join()).toMatch(
      /verschiedene Zeichen/,
    );
    expect(problemsOf({ ...good, SHOP_MASTER_KEY_V1: Buffer.alloc(16).toString("base64") }).join()).toMatch(
      /32 Byte/,
    );
  });

  it("lehnt unbekannte Umgebungen, Ports und Ja/Nein-Werte ab", () => {
    expect(problemsOf({ ...good, SHOP_ENV: "prod" }).join()).toMatch(/^SHOP_ENV:/);
    expect(problemsOf({ ...good, SHOP_API_PORT: "70000" }).join()).toMatch(/^SHOP_API_PORT:/);
    expect(problemsOf({ ...good, SHOP_FEATURE_X: "yes" }).join()).toMatch(/^SHOP_FEATURE_X:/);
    expect(problemsOf({ ...good, SHOP_DOMAIN: "Shop Domain" }).join()).toMatch(/^SHOP_DOMAIN:/);
  });

  it("verlangt außerhalb von local und test TLS zur Datenbank", () => {
    const prod = { ...good, SHOP_ENV: "production", SHOP_DOMAIN: "shop.example" };
    expect(problemsOf(prod)).toEqual([
      "SHOP_APP_DATABASE_URL: muss außerhalb von local und test sslmode=verify-full verlangen",
    ]);
    expect(
      problemsOf({ ...prod, SHOP_APP_DATABASE_URL: `${good.SHOP_APP_DATABASE_URL}?sslmode=verify-full` }),
    ).toEqual([]);
  });

  it("zeigt in der Fehlermeldung nie die Werte selbst (Sicherheit 5.10)", () => {
    const leaky = {
      ...good,
      SHOP_SESSION_SECRET: "geheim-aber-kurz",
      SHOP_APP_DATABASE_URL: "mysql://shop_app:SuperGeheim123@db/shop",
      SHOP_ENV: "staging-SuperGeheim",
    };
    let message = "";
    try {
      loadConfig(schema, leaky);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Das Programm startet nicht");
    expect(message).not.toContain("geheim-aber-kurz");
    expect(message).not.toContain("SuperGeheim");
  });

  it("funktioniert mit eigenen Schemas", () => {
    const c = loadConfig(z.object({ A: z.string() }), { A: "1" });
    expect(c.A).toBe("1");
  });
});
