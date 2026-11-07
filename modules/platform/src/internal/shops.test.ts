import { uuidv7, type Database } from "@shop/kernel";
import { describe, expect, it } from "vitest";
import { createShopDirectory, MAX_SHOPS_PER_LOOKUP } from "./shops.js";

// Griff ohne Verbindung: Jeder echte Datenbankzugriff würde scheitern. Die Datenbank-Seite prüft
// apps/api/src/memberships.db.test.ts.
const unconnected: Database<unknown> = { destroy: async () => undefined };

describe("getShops ohne Datenbank", () => {
  const shops = createShopDirectory({ database: unconnected });

  it("ohne gültige Kennungen gar keine Abfrage, leere Liste", async () => {
    expect(await shops.getShops([])).toEqual([]);
    expect(await shops.getShops(["teeladen", "' OR 1=1 --", ""])).toEqual([]);
  });

  it("zu viele Kennungen auf einmal werden abgelehnt", async () => {
    const ids = Array.from({ length: MAX_SHOPS_PER_LOOKUP + 1 }, () => uuidv7());
    await expect(shops.getShops(ids)).rejects.toThrow(RangeError);
  });

  it("mit gültiger Kennung wird die Datenbank gefragt (hier: nicht verbunden)", async () => {
    await expect(shops.getShops([uuidv7()])).rejects.toThrow(/nicht verbunden/);
  });
});
