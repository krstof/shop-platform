// Erzeugt die Datei .env aus .env.example und ersetzt Platzhalter durch Zufallswerte.
// Bereits vorhandene Werte in .env bleiben unverändert, neue Einträge aus der Vorlage
// werden ergänzt. Die Datei ist nur für den eigenen Nutzer lesbar (Rechte 600).
// Sicherheit 5.10: Zufall nur aus crypto.randomBytes, nie aus Math.random.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {Record<string, () => string>} */
export const GENERATORS = {
  __SECRET__: () => randomBytes(36).toString("base64url"),
  __HEX32__: () => randomBytes(32).toString("hex"),
  __KEY32__: () => randomBytes(32).toString("base64"),
  __S3_KEY_ID__: () => "GK" + randomBytes(12).toString("hex"),
};

/**
 * Liest KEY=VALUE-Zeilen (Kommentare und Leerzeilen werden übersprungen).
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] !== undefined && m[2] !== undefined) map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Baut den Inhalt der neuen .env: Struktur und Kommentare aus der Vorlage,
 * Werte aus der bestehenden .env oder frisch erzeugt.
 * @param {string} template
 * @param {string} existing
 * @returns {{ content: string, generated: string[], kept: string[] }}
 */
export function buildEnv(template, existing) {
  const current = parseEnv(existing);
  /** @type {string[]} */ const generated = [];
  /** @type {string[]} */ const kept = [];
  const lines = template.split(/\r?\n/).map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m || m[1] === undefined || m[2] === undefined) return line;
    const key = m[1];
    const value = m[2];
    const old = current.get(key);
    if (old !== undefined && !(old in GENERATORS)) {
      kept.push(key);
      return `${key}=${old}`;
    }
    const gen = GENERATORS[value];
    if (gen) {
      generated.push(key);
      return `${key}=${gen()}`;
    }
    return line;
  });
  // Einträge, die nur in der alten .env stehen, gehen nicht verloren.
  const templateKeys = new Set(parseEnv(template).keys());
  const extra = [...current].filter(([k]) => !templateKeys.has(k));
  if (extra.length > 0) {
    lines.push("", "# --- Eigene Einträge, die nicht in .env.example stehen ---");
    for (const [k, v] of extra) lines.push(`${k}=${v}`);
  }
  return { content: lines.join("\n"), generated, kept };
}

/**
 * @param {string} root Ordner mit .env.example
 */
export function setupEnv(root) {
  const templatePath = resolve(root, ".env.example");
  const envPath = resolve(root, ".env");
  const template = readFileSync(templatePath, "utf8");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const result = buildEnv(template, existing);
  writeFileSync(envPath, result.content, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { generated, kept } = setupEnv(root);
  console.log(`.env bereit: ${generated.length} Werte neu erzeugt, ${kept.length} beibehalten.`);
}
