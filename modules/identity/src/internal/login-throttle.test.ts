// T-10, Teil ohne Datenbank: Bremse und Sperre der Anmeldung (Sicherheit 5.2).
import { describe, expect, it } from "vitest";
import { LOGIN_THROTTLE_RULES, LoginThrottle, loginNetwork } from "./login-throttle.js";

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (seconds: number) => {
      t += seconds * 1000;
    },
  };
}

const A = { email: "inhaberin@teeladen.example", ipAddress: "203.0.113.7" };

describe("LoginThrottle", () => {
  it("lässt 5 Fehlversuche ohne Wartezeit zu, danach wächst sie: 1, 2, 4, 8 ... höchstens 60 s", () => {
    const c = clock();
    const t = new LoginThrottle(LOGIN_THROTTLE_RULES, c.now);
    for (let i = 0; i < 4; i++) {
      expect(t.check(A).allowed).toBe(true);
      t.recordFailure(A);
    }
    expect(t.check(A).allowed).toBe(true);
    const waits: number[] = [];
    for (let failure = 5; failure < 20; failure++) {
      t.recordFailure(A);
      const d = t.check(A);
      if (d.allowed) throw new Error(`nach Fehlversuch ${failure} keine Wartezeit`);
      waits.push(d.retryAfterSeconds);
      c.advance(d.retryAfterSeconds);
      expect(t.check(A).allowed).toBe(true);
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60, 60, 60, 60, 60]);
  });

  it("sperrt beim 20. Fehlversuch für 15 Minuten, auch das richtige Passwort kommt nicht durch", () => {
    const c = clock();
    const t = new LoginThrottle(LOGIN_THROTTLE_RULES, c.now);
    let outcome = {};
    for (let i = 1; i <= 20; i++) {
      const d = t.check(A);
      if (!d.allowed) c.advance(d.retryAfterSeconds);
      outcome = t.recordFailure(A);
      if (i < 20) expect(outcome).toEqual({});
    }
    expect(outcome).toEqual({
      accountLockedUntil: new Date(c.now() + 15 * 60 * 1000),
      networkLockedUntil: new Date(c.now() + 15 * 60 * 1000),
    });
    expect(t.check(A)).toEqual({ allowed: false, retryAfterSeconds: 900 });
    c.advance(899);
    expect(t.check(A).allowed).toBe(false);
    c.advance(1);
    expect(t.check(A).allowed).toBe(true);
  });

  it("behandelt eine unbekannte E-Mail genau wie eine bekannte (verrät nichts)", () => {
    const run = (email: string) => {
      const c = clock();
      const t = new LoginThrottle(LOGIN_THROTTLE_RULES, c.now);
      const seen: unknown[] = [];
      for (let i = 0; i < 25; i++) {
        seen.push(t.check({ email }));
        seen.push(t.recordFailure({ email }));
      }
      return JSON.stringify(seen).replaceAll(email, "E");
    };
    expect(run("niemand@teeladen.example")).toBe(run("inhaberin@teeladen.example"));
  });

  it("bremst ein Netz, das viele Konten durchprobiert (IPv6 als /64)", () => {
    const c = clock();
    const t = new LoginThrottle(LOGIN_THROTTLE_RULES, c.now);
    // Jede Anfrage mit neuer Adresse aus demselben /64 und neuem Konto
    for (let i = 0; i < 5; i++)
      t.recordFailure({ email: `k${i}@x.example`, ipAddress: `2001:db8:1:2::${i + 1}` });
    expect(t.check({ email: "neu@x.example", ipAddress: "2001:db8:1:2:ffff::9" }).allowed).toBe(false);
    // Ein anderes /64 und ein anderes Konto sind frei.
    expect(t.check({ email: "neu@x.example", ipAddress: "2001:db8:1:3::1" }).allowed).toBe(true);
    expect(loginNetwork("2001:db8:1:2:ffff::9")).toBe(loginNetwork("2001:db8:1:2::1"));
    expect(loginNetwork("203.0.113.7")).not.toBe(loginNetwork("203.0.113.8"));
  });

  it("eine erfolgreiche Anmeldung leert nur den Zähler des Kontos, nie den des Netzes", () => {
    const c = clock();
    const t = new LoginThrottle(LOGIN_THROTTLE_RULES, c.now);
    for (let i = 0; i < 5; i++) t.recordFailure(A);
    t.recordSuccess(A);
    // Konto frei, Netz weiter gebremst: Ein Angreifer kann seinen Zähler nicht mit dem eigenen Konto leeren.
    expect(t.check({ email: A.email }).allowed).toBe(true);
    expect(t.check(A).allowed).toBe(false);
  });

  it("vergisst Fehlversuche nach 15 Minuten Ruhe", () => {
    const c = clock();
    const t = new LoginThrottle(LOGIN_THROTTLE_RULES, c.now);
    for (let i = 0; i < 4; i++) t.recordFailure(A);
    c.advance(15 * 60 + 1);
    t.recordFailure(A);
    expect(t.check(A).allowed).toBe(true);
  });

  it("merkt sich höchstens maxKeys Zähler (schützt den Speicher)", () => {
    const t = new LoginThrottle(LOGIN_THROTTLE_RULES, Date.now, 100);
    for (let i = 0; i < 500; i++) t.recordFailure({ email: `k${i}@x.example` });
    expect(t.size).toBeLessThanOrEqual(100);
  });
});
