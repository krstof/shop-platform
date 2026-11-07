// Verschlüsselung von Geheimnissen in der Datenbank (Sicherheit 5.10, SIC-06, Envelope Encryption).
//
// Jeder Wert bekommt einen eigenen, zufälligen Schlüssel (Datenschlüssel). Mit ihm wird der Wert
// mit AES-256-GCM verschlüsselt; der Datenschlüssel selbst wird mit dem Hauptschlüssel verschlüsselt
// und neben dem Wert gespeichert. Der Hauptschlüssel liegt nie in der Datenbank, sondern nur in der
// Serverkonfiguration (SHOP_MASTER_KEY_V1, später _V2 ...). Jeder verschlüsselte Wert trägt die
// Version des Hauptschlüssels, damit ein Wechsel möglich ist: alte Werte bleiben lesbar, neue
// bekommen die neueste Version.
//
// Zusätzlich bindet ein „Zweck“ (zum Beispiel `identity.two_factor.secret:<user-id>`) den Wert an
// seine Stelle. Wer einen verschlüsselten Wert in eine andere Zeile kopiert, bekommt beim Lesen
// einen Fehler statt eines fremden Geheimnisses (AES-GCM prüft den Zweck als „associated data“).
//
// Aufbau (Bytes): 0x01 | Schlüsselversion (2) | IV Datenschlüssel (12) | verschl. Datenschlüssel (32)
//   | Tag Datenschlüssel (16) | IV Wert (12) | Tag Wert (16) | verschlüsselter Wert (Rest)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FORMAT = 0x01;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + 2 + IV_BYTES + KEY_BYTES + TAG_BYTES + IV_BYTES + TAG_BYTES;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export interface SecretBox {
  /** Verschlüsselt mit der neuesten Version des Hauptschlüssels. */
  seal(plaintext: Uint8Array, purpose: string): Buffer;
  /** Entschlüsselt; wirft SecretBoxError bei falschem Zweck, unbekannter Version oder Manipulation. */
  open(sealed: Uint8Array, purpose: string): Buffer;
  /** Version, mit der ein Wert verschlüsselt ist (zum späteren Umschlüsseln). */
  keyVersion(sealed: Uint8Array): number;
}

function gcmSeal(key: Buffer, plaintext: Uint8Array, aad: Buffer): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function gcmOpen(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new SecretBoxError("Verschlüsselter Wert ist ungültig oder gehört an eine andere Stelle");
  }
}

/**
 * @param masterKeys Hauptschlüssel je Version (je 32 Byte). Neue Werte nutzen die höchste Version.
 */
export function createSecretBox(masterKeys: ReadonlyMap<number, Uint8Array>): SecretBox {
  if (masterKeys.size === 0) throw new SecretBoxError("Kein Hauptschlüssel angegeben");
  const keys = new Map<number, Buffer>();
  for (const [version, key] of masterKeys) {
    if (!Number.isInteger(version) || version < 1 || version > 0xffff)
      throw new SecretBoxError("Version des Hauptschlüssels muss zwischen 1 und 65535 liegen");
    if (key.length !== KEY_BYTES) throw new SecretBoxError("Hauptschlüssel muss genau 32 Byte lang sein");
    keys.set(version, Buffer.from(key));
  }
  const current = Math.max(...keys.keys());

  function header(sealed: Uint8Array): number {
    if (sealed.length < HEADER_BYTES || sealed[0] !== FORMAT)
      throw new SecretBoxError("Unbekanntes Format eines verschlüsselten Werts");
    return Buffer.from(sealed).readUInt16BE(1);
  }

  return {
    seal(plaintext, purpose) {
      const master = keys.get(current);
      if (master === undefined) throw new SecretBoxError("Hauptschlüssel fehlt");
      const version = Buffer.alloc(2);
      version.writeUInt16BE(current);
      // Zweck und Version gehören zu den geprüften Daten: Herabstufen auf eine alte Version fällt auf.
      const aad = Buffer.concat([version, Buffer.from(purpose, "utf8")]);
      const dataKey = randomBytes(KEY_BYTES);
      try {
        const wrapped = gcmSeal(master, dataKey, aad);
        const value = gcmSeal(dataKey, plaintext, aad);
        return Buffer.concat([
          Buffer.from([FORMAT]),
          version,
          wrapped.iv,
          wrapped.data,
          wrapped.tag,
          value.iv,
          value.tag,
          value.data,
        ]);
      } finally {
        dataKey.fill(0);
      }
    },

    open(sealed, purpose) {
      const versionNumber = header(sealed);
      const master = keys.get(versionNumber);
      if (master === undefined)
        throw new SecretBoxError("Hauptschlüssel dieser Version ist nicht eingestellt");
      const b = Buffer.from(sealed);
      let o = 3;
      const take = (n: number): Buffer => {
        const part = b.subarray(o, o + n);
        o += n;
        return part;
      };
      const aad = Buffer.concat([b.subarray(1, 3), Buffer.from(purpose, "utf8")]);
      const wrapIv = take(IV_BYTES);
      const wrapped = take(KEY_BYTES);
      const wrapTag = take(TAG_BYTES);
      const iv = take(IV_BYTES);
      const tag = take(TAG_BYTES);
      const data = b.subarray(o);
      const dataKey = gcmOpen(master, wrapIv, wrapTag, wrapped, aad);
      try {
        return gcmOpen(dataKey, iv, tag, data, aad);
      } finally {
        dataKey.fill(0);
      }
    },

    keyVersion(sealed) {
      return header(sealed);
    },
  };
}

/**
 * Hauptschlüssel aus der Umgebung: SHOP_MASTER_KEY_V1, SHOP_MASTER_KEY_V2 ... (je 32 Byte Base64,
 * vorher von der Konfigurationsprüfung mit `base64Key()` geprüft).
 */
export function masterKeysFromEnv(env: Readonly<Record<string, string | undefined>>): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const m = /^SHOP_MASTER_KEY_V([1-9][0-9]{0,4})$/.exec(name);
    if (m?.[1] === undefined || value === undefined) continue;
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) throw new SecretBoxError(`${name} muss genau 32 Byte lang sein`);
    keys.set(Number(m[1]), key);
  }
  return keys;
}
