// Anfragebremse im Arbeitsspeicher (Sicherheit 5.8, SIC-05, Q-15, T-18).
// Verfahren „Token-Eimer“: Jeder Schlüssel hat einen Eimer mit `limit` Marken, der sich
// gleichmäßig über `windowMs` wieder auffüllt. Jede Anfrage nimmt eine Marke; ist der Eimer leer,
// kommt 429 mit `Retry-After`. Ab mehreren Instanzen zählt Valkey statt des Arbeitsspeichers.
//
// IPv6-Adressen werden auf ihr /64-Netz gekürzt: Ein Anschluss bekommt meist ein ganzes /64,
// ein Angreifer könnte sonst mit jeder Anfrage eine neue Adresse nehmen (CVE-2026-45364).
import type { RateLimitCategory } from "@shop/http";
import { truncateIp } from "@shop/kernel";

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

/** Startwerte aus Sicherheit 5.8. `anonymous` gilt vor der Anmeldung je Netz für alle Anfragen. */
export const DEFAULT_RATE_LIMITS: Readonly<Record<RateLimitCategory | "anonymous", RateLimitRule>> = {
  anonymous: { limit: 600, windowMs: 60_000 },
  admin: { limit: 600, windowMs: 60_000 },
  platform: { limit: 120, windowMs: 60_000 },
  "store-read": { limit: 300, windowMs: 60_000 },
  "store-write": { limit: 60, windowMs: 60_000 },
  login: { limit: 5, windowMs: 60_000 },
  coupon: { limit: 10, windowMs: 60_000 },
};

export type RateLimits = Readonly<Record<RateLimitCategory | "anonymous", RateLimitRule>>;

export type RateLimitResult =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Netz einer Adresse für die Bremse: IPv4 vollständig, IPv6 auf /64 gekürzt. */
export function clientNetwork(ip: string): string {
  return truncateIp(ip, { v4Prefix: 32, v6Prefix: 64 }) ?? "unbekannt";
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limits: RateLimits = DEFAULT_RATE_LIMITS,
    private readonly now: () => number = Date.now,
    /** Obergrenze der gemerkten Schlüssel, damit die Bremse selbst den Speicher nicht füllt. */
    private readonly maxKeys = 100_000,
  ) {}

  /** Nimmt eine Marke für `key` im Bereich `category`. */
  take(category: RateLimitCategory | "anonymous", key: string): RateLimitResult {
    const rule = this.limits[category];
    const id = `${category}|${key}`;
    const t = this.now();
    const refillPerMs = rule.limit / rule.windowMs;
    let bucket = this.buckets.get(id);
    if (bucket === undefined) {
      this.evictIfFull();
      bucket = { tokens: rule.limit, updatedAt: t };
    } else {
      bucket.tokens = Math.min(rule.limit, bucket.tokens + (t - bucket.updatedAt) * refillPerMs);
      bucket.updatedAt = t;
      // Neu einsortieren: Die Map bleibt nach letzter Nutzung geordnet, die ältesten fliegen zuerst.
      this.buckets.delete(id);
    }
    this.buckets.set(id, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)),
    };
  }

  get size(): number {
    return this.buckets.size;
  }

  private evictIfFull(): void {
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done === true) return;
      this.buckets.delete(oldest.value);
    }
  }
}
