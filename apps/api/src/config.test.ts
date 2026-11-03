import { ConfigError } from "@shop/kernel";
import { describe, expect, it } from "vitest";
import { loadApiConfig } from "./config.js";

const base = { SHOP_ENV: "local", SHOP_DOMAIN: "localhost" };

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

  it("verlangt außerhalb von local TLS zur Datenbank", () => {
    expect(() =>
      loadApiConfig({
        ...base,
        SHOP_ENV: "production",
        SHOP_APP_DATABASE_URL: "postgres://shop_app:x@db/shop",
      }),
    ).toThrow(/sslmode=verify-full/);
  });

  it("Standard: nur auf 127.0.0.1, Port 3000", () => {
    const c = loadApiConfig({ ...base, SHOP_APP_DATABASE_URL: "postgres://shop_app:x@db/shop" });
    expect(c.SHOP_API_HOST).toBe("127.0.0.1");
    expect(c.SHOP_API_PORT).toBe(3000);
  });
});
