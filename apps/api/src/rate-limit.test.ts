// T-18: Anfragebremse liefert 429 mit Retry-After (Sicherheit 5.8, Q-15).
import { defineEndpoint, type AuthenticatedActor } from "@shop/http";
import { createLogger, uuidv7 } from "@shop/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ActorResolver } from "./actor.js";
import { API_SECURITY_HEADERS, createApi } from "./app.js";
import { memoryIdempotencyStore } from "./idempotency-store.js";
import { clientNetwork, DEFAULT_RATE_LIMITS, RateLimiter, type RateLimits } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("lässt genau limit Anfragen durch, dann 429 mit Wartezeit, und füllt sich wieder auf", () => {
    let now = 0;
    const limiter = new RateLimiter(
      { ...DEFAULT_RATE_LIMITS, login: { limit: 5, windowMs: 60_000 } },
      () => now,
    );
    for (let i = 0; i < 5; i++) expect(limiter.take("login", "k").allowed).toBe(true);
    const blocked = limiter.take("login", "k");
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 12 });
    now += 11_000;
    expect(limiter.take("login", "k").allowed).toBe(false);
    now += 1_000;
    expect(limiter.take("login", "k").allowed).toBe(true);
    // Andere Schlüssel und Bereiche sind unabhängig.
    expect(limiter.take("login", "anderer").allowed).toBe(true);
    expect(limiter.take("coupon", "k").allowed).toBe(true);
  });

  it("IPv6 wird auf /64 gekürzt, IPv4 bleibt vollständig (CVE-2026-45364)", () => {
    expect(clientNetwork("2001:db8:1:2:aaaa::1")).toBe(clientNetwork("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(clientNetwork("2001:db8:1:2::1")).not.toBe(clientNetwork("2001:db8:1:3::1"));
    expect(clientNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetwork("kaputt")).toBe("unbekannt");
  });

  it("merkt sich höchstens maxKeys Schlüssel und wirft die ältesten zuerst hinaus", () => {
    const limiter = new RateLimiter(DEFAULT_RATE_LIMITS, Date.now, 3);
    for (const k of ["a", "b", "c", "d"]) limiter.take("admin", k);
    expect(limiter.size).toBe(3);
  });
});

const small: RateLimits = {
  ...DEFAULT_RATE_LIMITS,
  anonymous: { limit: 4, windowMs: 60_000 },
  admin: { limit: 2, windowMs: 60_000 },
};

const ping = defineEndpoint({
  api: "admin",
  method: "GET",
  path: "/ping",
  operationId: "pingTest",
  summary: "Test-Ping",
  description: "Testendpunkt für die Bremse.",
  tags: ["Test"],
  access: { scopes: ["products:read"] },
  response: { status: 200, description: "ok", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

const resolver: ActorResolver = async ({ headers }) => {
  const user = headers["x-test-user"];
  if (typeof user !== "string") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "api_token", id: user },
    tenantId: uuidv7(),
    scopes: new Set(["products:read"]),
  };
  return auth;
};

async function api(limits: RateLimits) {
  return createApi({
    endpoints: [ping],
    resolveActor: resolver,
    logger: createLogger({ level: "silent" }),
    idempotency: memoryIdempotencyStore(),
    rateLimiter: new RateLimiter(limits),
  });
}

describe("T-18: Anfragebremse in der API", () => {
  it("vor der Anmeldung je Netz: auch 401-Fluten und unbekannte Adressen werden gebremst", async () => {
    const app = await api({ ...small, admin: { limit: 100, windowMs: 60_000 } });
    try {
      const f = app.getHttpAdapter().getInstance();
      const statuses = [];
      for (let i = 0; i < 4; i++)
        statuses.push((await f.inject({ url: i % 2 ? "/admin/v1/ping" : "/gibt-es-nicht" })).statusCode);
      expect(statuses).toEqual([404, 401, 404, 401]);
      const r = await f.inject({ url: "/admin/v1/ping", headers: { "accept-language": "en" } });
      expect(r.statusCode).toBe(429);
      expect(Number(r.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(r.headers["content-type"]).toBe("application/problem+json; charset=utf-8");
      expect(r.json()).toMatchObject({
        code: "rate_limited",
        title: "Too many requests. Please wait a moment.",
      });
      // Ein anderes Netz ist nicht betroffen.
      expect((await f.inject({ url: "/admin/v1/ping", remoteAddress: "198.51.100.9" })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("wechselnde IPv6-Adressen im selben /64 helfen nicht", async () => {
    const app = await api(small);
    try {
      const f = app.getHttpAdapter().getInstance();
      const statuses = [];
      for (let i = 1; i <= 5; i++)
        statuses.push(
          (await f.inject({ url: "/admin/v1/ping", remoteAddress: `2001:db8:5:6::${i.toString(16)}` }))
            .statusCode,
        );
      expect(statuses).toEqual([401, 401, 401, 401, 429]);
      expect((await f.inject({ url: "/admin/v1/ping", remoteAddress: "2001:db8:5:7::1" })).statusCode).toBe(
        401,
      );
    } finally {
      await app.close();
    }
  });

  it("nach der Anmeldung je Akteur: ein Token bremst nur sich selbst", async () => {
    const app = await api({ ...small, anonymous: { limit: 100, windowMs: 60_000 } });
    try {
      const f = app.getHttpAdapter().getInstance();
      const call = (user: string) => f.inject({ url: "/admin/v1/ping", headers: { "x-test-user": user } });
      expect([
        (await call("t1")).statusCode,
        (await call("t1")).statusCode,
        (await call("t1")).statusCode,
      ]).toEqual([200, 200, 429]);
      expect((await call("t2")).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("jede Antwort trägt die Sicherheits-Header der API, auch Fehler", async () => {
    const app = await api(DEFAULT_RATE_LIMITS);
    try {
      const f = app.getHttpAdapter().getInstance();
      for (const r of [
        await f.inject({ url: "/admin/v1/ping", headers: { "x-test-user": "t" } }),
        await f.inject({ url: "/nix" }),
      ]) {
        for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) expect(r.headers[name]).toBe(value);
        expect(r.headers["cache-control"]).toBe("no-store");
        expect(r.headers["x-powered-by"]).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
});
