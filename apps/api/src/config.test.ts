import { randomBytes } from "node:crypto";
import { ConfigError } from "@shop/kernel";
import { describe, expect, it } from "vitest";
import { loadApiConfig } from "./config.js";

const base = {
  SHOP_ENV: "local",
  SHOP_DOMAIN: "localhost",
  SHOP_APP_DATABASE_URL: "postgres://shop_app:x@db/shop",
  SHOP_AUTH_DATABASE_URL: "postgres://shop_auth:x@db/shop",
  SHOP_AUTH_SECRET: randomBytes(32).toString("base64url"),
};

describe("Einstellungen der API", () => {
  it("verlangt die Rolle shop_app und nennt nur den Namen, nie den Wert", () => {
    try {
      loadApiConfig({ ...base, SHOP_APP_DATABASE_URL: "postgres://shop_owner:Geheim123@db/shop" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain("SHOP_APP_DATABASE_URL: muss die Rolle shop_app verwenden");
      expect((e as Error).message).not.toContain("Geheim123");
    }
  });

  it("verlangt für die Anmeldung die Rolle shop_auth und ein starkes Geheimnis", () => {
    expect(() => loadApiConfig({ ...base, SHOP_AUTH_DATABASE_URL: "postgres://shop_app:x@db/shop" })).toThrow(
      /SHOP_AUTH_DATABASE_URL: muss die Rolle shop_auth verwenden/,
    );
    expect(() => loadApiConfig({ ...base, SHOP_AUTH_SECRET: "zu-kurz" })).toThrow(
      /SHOP_AUTH_SECRET: zu kurz/,
    );
    expect(() => loadApiConfig({ ...base, SHOP_AUTH_SECRET: "__SECRET__" })).toThrow(/SHOP_AUTH_SECRET/);
    const { SHOP_AUTH_SECRET: _s, ...without } = base;
    void _s;
    expect(() => loadApiConfig(without)).toThrow(/SHOP_AUTH_SECRET: fehlt/);
  });

  it("verlangt außerhalb von local TLS zur Datenbank", () => {
    expect(() => loadApiConfig({ ...base, SHOP_ENV: "production" })).toThrow(/sslmode=verify-full/);
  });

  it("Standard: nur auf 127.0.0.1, Port 3000, Herkunft Backoffice und Plattform-Verwaltung", () => {
    const c = loadApiConfig(base);
    expect(c.SHOP_API_HOST).toBe("127.0.0.1");
    expect(c.SHOP_API_PORT).toBe(3000);
    expect(c.SHOP_ALLOWED_ORIGINS).toEqual(["https://admin.localhost", "https://platform.localhost"]);
  });

  it("erlaubte Herkünfte: nur https und ohne Pfad", () => {
    expect(
      loadApiConfig({ ...base, SHOP_ALLOWED_ORIGINS: "https://a.example, https://b.example:8443" })
        .SHOP_ALLOWED_ORIGINS,
    ).toEqual(["https://a.example", "https://b.example:8443"]);
    expect(() => loadApiConfig({ ...base, SHOP_ALLOWED_ORIGINS: "http://a.example" })).toThrow(/https/);
    expect(() => loadApiConfig({ ...base, SHOP_ALLOWED_ORIGINS: "https://a.example/admin" })).toThrow(
      /keine Herkunft/,
    );
  });
});
