import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";
import { allSubscribers } from "./subscribers.js";

const base = {
  SHOP_ENV: "local",
  SHOP_DOMAIN: "localhost",
  SHOP_APP_DATABASE_URL: "postgres://shop_app:x@127.0.0.1:5432/shop",
  SHOP_RELAY_DATABASE_URL: "postgres://shop_relay:x@127.0.0.1:5432/shop",
};

describe("Einstellungen des Workers", () => {
  it("nimmt gültige Einstellungen mit Standardfrist von 30 Tagen", () => {
    expect(loadWorkerConfig(base).SHOP_OUTBOX_RETENTION_DAYS).toBe(30);
  });

  it("verlangt für jede Verbindung genau ihre Rolle", () => {
    expect(() =>
      loadWorkerConfig({ ...base, SHOP_APP_DATABASE_URL: "postgres://shop_relay:x@127.0.0.1/shop" }),
    ).toThrow(/SHOP_APP_DATABASE_URL/);
    expect(() =>
      loadWorkerConfig({ ...base, SHOP_RELAY_DATABASE_URL: "postgres://postgres:x@127.0.0.1/shop" }),
    ).toThrow(/SHOP_RELAY_DATABASE_URL/);
  });

  it("nennt in Fehlern nie den Wert (Passwort)", () => {
    try {
      loadWorkerConfig({ ...base, SHOP_RELAY_DATABASE_URL: "postgres://postgres:GEHEIM@127.0.0.1/shop" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("GEHEIM");
    }
  });

  it("lehnt eine Aufbewahrungsfrist unter einem Tag ab", () => {
    expect(() => loadWorkerConfig({ ...base, SHOP_OUTBOX_RETENTION_DAYS: "0" })).toThrow();
  });

  it("Selbst-Neustart nach 180 s Krankheit, 0 schaltet ihn ab", () => {
    expect(loadWorkerConfig(base).SHOP_WORKER_UNHEALTHY_EXIT_SECONDS).toBe(180);
    expect(
      loadWorkerConfig({ ...base, SHOP_WORKER_UNHEALTHY_EXIT_SECONDS: "0" })
        .SHOP_WORKER_UNHEALTHY_EXIT_SECONDS,
    ).toBe(0);
    expect(() => loadWorkerConfig({ ...base, SHOP_WORKER_UNHEALTHY_EXIT_SECONDS: "-1" })).toThrow(
      /SHOP_WORKER_UNHEALTHY_EXIT_SECONDS/,
    );
  });

  it("Lebenszeichen auf Port 3001, nur unprivilegierte Ports erlaubt", () => {
    expect(loadWorkerConfig(base).SHOP_WORKER_HEALTH_PORT).toBe(3001);
    expect(loadWorkerConfig({ ...base, SHOP_WORKER_HEALTH_PORT: "4000" }).SHOP_WORKER_HEALTH_PORT).toBe(4000);
    expect(() => loadWorkerConfig({ ...base, SHOP_WORKER_HEALTH_PORT: "80" })).toThrow(
      /SHOP_WORKER_HEALTH_PORT/,
    );
    expect(() => loadWorkerConfig({ ...base, SHOP_WORKER_HEALTH_PORT: "abc" })).toThrow(
      /SHOP_WORKER_HEALTH_PORT/,
    );
  });
});

describe("Subscriber", () => {
  it("audit.record hört auf alle Ereignisse, kein Name doppelt", () => {
    const subs = allSubscribers();
    expect(subs.map((s) => s.name)).toContain("audit.record");
    expect(subs.find((s) => s.name === "audit.record")?.events).toBe("*");
    expect(new Set(subs.map((s) => s.name)).size).toBe(subs.length);
  });
});
