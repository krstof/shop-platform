// Eigene Bremse für die Anmeldung (Sicherheit 5.2, SIC-02, B-03, T-10).
//
// Zwei Zähler je Anmeldeversuch: einer je Konto (E-Mail, klein geschrieben) und einer je Netz
// (IPv4-Adresse, IPv6 auf das /64-Netz gekürzt, CVE-2026-45364). Beide zählen Fehlversuche:
//   - die ersten 5 Fehlversuche sind frei,
//   - ab dem 5. muss vor dem nächsten Versuch gewartet werden, 1 s, 2 s, 4 s ... höchstens 60 s,
//   - beim 20. Fehlversuch wird das Konto 15 Minuten gesperrt. Ein Netz wird nie gesperrt, nur
//     gebremst (höchstens 60 s Wartezeit), damit nicht alle hinter derselben Büro-Adresse
//     mitgesperrt werden (Entscheidung Kristof 06.11.2026).
// Der Konto-Zähler läuft auch für E-Mail-Adressen, die es gar nicht gibt. So antwortet die Bremse
// in beiden Fällen gleich und verrät nicht, ob ein Konto existiert. Eine erfolgreiche Anmeldung
// setzt nur den Konto-Zähler zurück, nie den Zähler des Netzes (sonst könnte ein Angreifer mit
// eigenem Konto seinen Zähler immer wieder leeren).
//
// Die Zähler liegen im Arbeitsspeicher (wie die allgemeine Anfragebremse, Sicherheit 5.8). Die
// Sperre eines bestehenden Kontos steht zusätzlich in identity.user.locked_until und übersteht
// so einen Neustart. Ab mehreren Instanzen zählt Valkey statt des Arbeitsspeichers.
import { truncateIp } from "@shop/kernel";

export interface LoginThrottleRules {
  /** So viele Fehlversuche ohne Wartezeit. */
  readonly freeFailures: number;
  /** Beim wievielten Fehlversuch die Sperre greift. */
  readonly lockAfterFailures: number;
  readonly lockSeconds: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
  /** Ohne neuen Fehlversuch so lange vergisst die Bremse einen Zähler. */
  readonly forgetAfterSeconds: number;
}

export const LOGIN_THROTTLE_RULES: LoginThrottleRules = {
  freeFailures: 5,
  lockAfterFailures: 20,
  lockSeconds: 15 * 60,
  baseDelaySeconds: 1,
  maxDelaySeconds: 60,
  forgetAfterSeconds: 15 * 60,
};

export type ThrottleDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

interface Counter {
  failures: number;
  /** Vor diesem Zeitpunkt (ms) wird kein Versuch angenommen. */
  blockedUntil: number;
  lastFailureAt: number;
}

export interface FailureOutcome {
  /** Gesetzt, wenn dieser Fehlversuch das Konto gesperrt hat. */
  readonly accountLockedUntil?: Date;
}

/** Schlüssel eines Versuchs. Die E-Mail ist bereits getrimmt und klein geschrieben. */
export interface AttemptKeys {
  readonly email: string;
  readonly ipAddress?: string | undefined;
}

/** Netz einer Adresse: IPv4 vollständig, IPv6 auf /64 gekürzt. */
export function loginNetwork(ip: string): string {
  return truncateIp(ip, { v4Prefix: 32, v6Prefix: 64 }) ?? "unbekannt";
}

export class LoginThrottle {
  private readonly counters = new Map<string, Counter>();

  constructor(
    private readonly rules: LoginThrottleRules = LOGIN_THROTTLE_RULES,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 100_000,
  ) {}

  /** Darf jetzt ein Versuch stattfinden? Zählt selbst nichts. */
  check(keys: AttemptKeys): ThrottleDecision {
    const t = this.now();
    let waitMs = 0;
    for (const key of this.keysOf(keys)) {
      const c = this.current(key, t);
      if (c !== undefined && c.blockedUntil > t) waitMs = Math.max(waitMs, c.blockedUntil - t);
    }
    return waitMs === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }

  recordFailure(keys: AttemptKeys): FailureOutcome {
    const t = this.now();
    const [accountKey, networkKey] = this.keysOf(keys);
    const accountLock = accountKey === undefined ? undefined : this.fail(accountKey, t, true);
    if (networkKey !== undefined) this.fail(networkKey, t, false);
    return accountLock === undefined ? {} : { accountLockedUntil: accountLock };
  }

  /** Nach erfolgreicher Anmeldung: nur der Zähler des Kontos. */
  recordSuccess(keys: AttemptKeys): void {
    this.counters.delete(this.accountKey(keys.email));
  }

  get size(): number {
    return this.counters.size;
  }

  private accountKey(email: string): string {
    return `konto|${email}`;
  }

  private keysOf(keys: AttemptKeys): string[] {
    const out = [this.accountKey(keys.email)];
    if (keys.ipAddress !== undefined && keys.ipAddress !== "")
      out.push(`netz|${loginNetwork(keys.ipAddress)}`);
    return out;
  }

  private current(key: string, t: number): Counter | undefined {
    const c = this.counters.get(key);
    if (c === undefined) return undefined;
    if (c.blockedUntil <= t && t - c.lastFailureAt > this.rules.forgetAfterSeconds * 1000) {
      this.counters.delete(key);
      return undefined;
    }
    return c;
  }

  /**
   * Zählt einen Fehlversuch. Liefert das Ende der Sperre, wenn er die Sperre auslöst.
   * `lockable: false` (Netz): nur Wartezeit, nie Sperre.
   */
  private fail(key: string, t: number, lockable: boolean): Date | undefined {
    let c = this.current(key, t);
    if (c === undefined) {
      this.evictIfFull();
      c = { failures: 0, blockedUntil: 0, lastFailureAt: t };
    }
    this.counters.delete(key);
    this.counters.set(key, c);
    c.failures += 1;
    c.lastFailureAt = t;
    const r = this.rules;
    if (lockable && c.failures >= r.lockAfterFailures) {
      // Nach der Sperre beginnt die Zählung von vorn (wieder mit wachsender Wartezeit ab dem 5.).
      c.failures = 0;
      c.blockedUntil = t + r.lockSeconds * 1000;
      return new Date(c.blockedUntil);
    }
    if (c.failures >= r.freeFailures) {
      const delay = Math.min(r.maxDelaySeconds, r.baseDelaySeconds * 2 ** (c.failures - r.freeFailures));
      c.blockedUntil = Math.max(c.blockedUntil, t + delay * 1000);
    }
    return undefined;
  }

  private evictIfFull(): void {
    while (this.counters.size >= this.maxKeys) {
      const oldest = this.counters.keys().next();
      if (oldest.done === true) return;
      this.counters.delete(oldest.value);
    }
  }
}
