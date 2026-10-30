// Konfigurationsprüfung beim Start (Architektur 7, Sicherheit 5.13):
// Alle Einstellungen kommen aus Umgebungsvariablen und werden mit Zod geprüft.
// Fehlt etwas oder ist etwas unsicher, startet das Programm nicht und nennt genau
// die betroffenen Namen. Werte erscheinen nie in der Meldung, weil es Geheimnisse sein könnten.
import { z } from "zod";

export const SHOP_ENVS = ["local", "test", "staging", "production"] as const;
export type ShopEnv = (typeof SHOP_ENVS)[number];

/** Umgebungen, in denen lokale Abkürzungen (selbst signierte Zertifikate, Datenbank ohne TLS) erlaubt sind. */
export function isLocalEnv(env: ShopEnv): boolean {
  return env === "local" || env === "test";
}

/** Platzhalter aus `.env.example`, die nie als echter Wert durchgehen dürfen. */
const PLACEHOLDER_RE = /^__[A-Z0-9_]+__$/;
const WEAK_VALUES = new Set(["changeme", "password", "secret", "passwort", "geheim", "test", "admin"]);

/** Ein Geheimnis: mindestens `minLength` Zeichen (Standard 32, Sicherheit 5.10), kein Platzhalter. */
export function secret(minLength = 32) {
  return z
    .string()
    .min(minLength, `zu kurz (mindestens ${minLength} Zeichen)`)
    .refine((v) => !PLACEHOLDER_RE.test(v), "ist noch ein Platzhalter")
    .refine((v) => !WEAK_VALUES.has(v.toLowerCase()), "ist ein bekannter schwacher Wert")
    .refine((v) => new Set(v).size >= 8, "hat zu wenige verschiedene Zeichen");
}

/** Schlüssel mit genau `bytes` Byte in Base64 (zum Beispiel der Hauptschlüssel mit 32 Byte). */
export function base64Key(bytes = 32) {
  return z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "ist kein Base64")
    .refine((v) => Buffer.from(v, "base64").length === bytes, `muss genau ${bytes} Byte lang sein`);
}

/** Zahl aus einer Umgebungsvariablen (die immer Text ist). */
export function port() {
  return z.coerce.number().int().min(1).max(65_535);
}

/** Ja/Nein aus einer Umgebungsvariablen. Nur „true“ und „false“ sind erlaubt, nichts wird geraten. */
export function flag() {
  return z.enum(["true", "false"]).transform((v) => v === "true");
}

/**
 * PostgreSQL-Adresse. Außerhalb von `local` und `test` muss sie TLS mit Zertifikatsprüfung
 * verlangen (`sslmode=verify-full`), sonst startet das Programm nicht.
 */
export function postgresUrl() {
  return z
    .string()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "muss mit postgres:// beginnen")
    .refine((v) => URL.canParse(v), "ist keine gültige Adresse");
}

export function requiresTls(url: string): boolean {
  return new URL(url).searchParams.get("sslmode") === "verify-full";
}

/** Gemeinsame Grundeinstellungen aller Dienste. Dienste erweitern das Schema mit `.extend()`. */
export const baseConfigSchema = z.object({
  SHOP_ENV: z.enum(SHOP_ENVS),
  SHOP_DOMAIN: z
    .string()
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/,
      "ist kein gültiger Domainname",
    ),
  SHOP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      "Die Einstellungen sind unvollständig oder unsicher. Das Programm startet nicht.\n" +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Prüft die Umgebungsvariablen gegen ein Schema und gibt die Einstellungen eingefroren zurück.
 * Leere Werte gelten als fehlend. Zusätzlich wird geprüft, dass Datenbankadressen außerhalb
 * von `local` und `test` TLS verlangen (Feldnamen, die auf `_DATABASE_URL` enden).
 */
export function loadConfig<S extends z.ZodObject>(schema: S, env: Env = process.env): Readonly<z.infer<S>> {
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  const problems: string[] = [];
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = issue.path.map(String).join(".") || "(Einstellungen)";
      // Bei fehlenden Werten meldet Zod einen Typfehler; das übersetzen wir verständlich.
      const missing = issue.code === "invalid_type" && cleaned[name] === undefined;
      problems.push(`${name}: ${missing ? "fehlt" : issue.message}`);
    }
    throw new ConfigError(problems);
  }

  const config = result.data as Record<string, unknown>;
  const shopEnv = config["SHOP_ENV"];
  if (typeof shopEnv === "string" && !isLocalEnv(shopEnv as ShopEnv)) {
    for (const [key, value] of Object.entries(config)) {
      if (key.endsWith("_DATABASE_URL") && typeof value === "string" && !requiresTls(value)) {
        problems.push(`${key}: muss außerhalb von local und test sslmode=verify-full verlangen`);
      }
    }
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(result.data);
}
