import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox, masterKeysFromEnv, SecretBoxError } from "./secret-box.js";

const k1 = randomBytes(32);
const k2 = randomBytes(32);

describe("Envelope Encryption (Sicherheit 5.10)", () => {
  it("verschlüsselt und entschlüsselt", () => {
    const box = createSecretBox(new Map([[1, k1]]));
    const sealed = box.seal(Buffer.from("geheim"), "test:a");
    expect(box.open(sealed, "test:a").toString()).toBe("geheim");
    expect(sealed.includes(Buffer.from("geheim"))).toBe(false);
  });

  it("nutzt für jeden Wert einen neuen Datenschlüssel und IV", () => {
    const box = createSecretBox(new Map([[1, k1]]));
    const a = box.seal(Buffer.from("x"), "p");
    const b = box.seal(Buffer.from("x"), "p");
    expect(a.equals(b)).toBe(false);
  });

  it("lehnt einen anderen Zweck ab (Wert in fremde Zeile kopiert)", () => {
    const box = createSecretBox(new Map([[1, k1]]));
    const sealed = box.seal(Buffer.from("x"), "identity.two_factor.secret:user-a");
    expect(() => box.open(sealed, "identity.two_factor.secret:user-b")).toThrow(SecretBoxError);
  });

  it("erkennt jede veränderte Stelle", () => {
    const box = createSecretBox(new Map([[1, k1]]));
    const sealed = box.seal(Buffer.from("ein etwas längerer Wert"), "p");
    for (let i = 3; i < sealed.length; i++) {
      const copy = Buffer.from(sealed);
      copy[i] = (copy[i] ?? 0) ^ 0x01;
      expect(() => box.open(copy, "p"), `Byte ${i}`).toThrow(SecretBoxError);
    }
  });

  it("lehnt einen falschen Hauptschlüssel ab", () => {
    const sealed = createSecretBox(new Map([[1, k1]])).seal(Buffer.from("x"), "p");
    expect(() => createSecretBox(new Map([[1, k2]])).open(sealed, "p")).toThrow(SecretBoxError);
  });

  it("Schlüsselwechsel: neue Werte mit der neuesten Version, alte bleiben lesbar", () => {
    const old = createSecretBox(new Map([[1, k1]])).seal(Buffer.from("alt"), "p");
    const box = createSecretBox(
      new Map([
        [1, k1],
        [2, k2],
      ]),
    );
    const fresh = box.seal(Buffer.from("neu"), "p");
    expect(box.keyVersion(old)).toBe(1);
    expect(box.keyVersion(fresh)).toBe(2);
    expect(box.open(old, "p").toString()).toBe("alt");
    expect(box.open(fresh, "p").toString()).toBe("neu");
  });

  it("Herabstufen der Version im Kopf fällt auf", () => {
    const box = createSecretBox(
      new Map([
        [1, k1],
        [2, k2],
      ]),
    );
    const sealed = box.seal(Buffer.from("x"), "p");
    sealed.writeUInt16BE(1, 1);
    expect(() => box.open(sealed, "p")).toThrow(SecretBoxError);
  });

  it("lehnt fehlende Versionen, kurze Eingaben und falsche Schlüssellängen ab", () => {
    const sealed = createSecretBox(new Map([[2, k2]])).seal(Buffer.from("x"), "p");
    expect(() => createSecretBox(new Map([[1, k1]])).open(sealed, "p")).toThrow(/Version/);
    expect(() => createSecretBox(new Map([[1, k1]])).open(Buffer.alloc(10), "p")).toThrow(/Format/);
    expect(() => createSecretBox(new Map([[1, randomBytes(16)]]))).toThrow(/32 Byte/);
    expect(() => createSecretBox(new Map())).toThrow(SecretBoxError);
  });

  it("liest die Hauptschlüssel aus der Umgebung", () => {
    const keys = masterKeysFromEnv({
      SHOP_MASTER_KEY_V1: k1.toString("base64"),
      SHOP_MASTER_KEY_V3: k2.toString("base64"),
      SHOP_MASTER_KEY_X: "egal",
      OTHER: "x",
    });
    expect([...keys.keys()].sort()).toEqual([1, 3]);
    expect(() => masterKeysFromEnv({ SHOP_MASTER_KEY_V1: "kurz" })).toThrow(/32 Byte/);
  });
});
