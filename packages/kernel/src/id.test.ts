import { describe, expect, it } from "vitest";
import { isUuid, isUuidV7, uuidSchema, uuidv7, uuidv7Timestamp, uuidV7Schema } from "./id.js";

describe("uuidv7", () => {
  it("hat das Format nach RFC 9562 (Version 7, Variante 10)", () => {
    for (let i = 0; i < 1000; i++) {
      const id = uuidv7();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("enthält den Zeitstempel in Millisekunden", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it("ist eindeutig und streng aufsteigend sortiert, auch in derselben Millisekunde", () => {
    const ids = Array.from({ length: 20_000 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("bleibt aufsteigend, wenn die Uhr zurückspringt", () => {
    const a = uuidv7(Date.now() + 10_000);
    const b = uuidv7(Date.now()); // Uhr „zurück“
    expect(b > a).toBe(true);
  });

  it("ist nicht vorhersagbar (Zufallsteil unterscheidet sich)", () => {
    const tails = new Set(Array.from({ length: 100 }, () => uuidv7().slice(19)));
    expect(tails.size).toBe(100);
  });
});

describe("Prüfung von IDs", () => {
  it("erkennt UUIDs und UUIDv7", () => {
    const v4 = "8d6f4a8e-3b1c-4f7e-9a2b-1c3d5e7f9a0b";
    const v7 = uuidv7();
    expect(isUuid(v4)).toBe(true);
    expect(isUuidV7(v4)).toBe(false);
    expect(isUuidV7(v7)).toBe(true);
    expect(isUuid(v7.toUpperCase())).toBe(false);
    expect(isUuid("1 OR 1=1")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(uuidSchema.safeParse(v4).success).toBe(true);
    expect(uuidV7Schema.safeParse(v4).success).toBe(false);
    expect(() => uuidv7Timestamp(v4)).toThrow(TypeError);
  });
});
