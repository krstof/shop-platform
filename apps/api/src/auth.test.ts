// T-11 und Teile von T-10 ohne Datenbank: Auth-API, Herkunftsprüfung (CSRF) und Cookies im Router.
// Das Anmeldemodul ist hier nachgebaut; den echten Weg mit Datenbank prüft auth.db.test.ts.
import type { IdentityService, SignInRequest } from "@shop/identity";
import { createLogger, uuidv7 } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessionResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints, unconnectedDatabase } from "./endpoints.js";
import { memoryIdempotencyStore } from "./idempotency-store.js";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./rate-limit.js";
import { isAllowedOrigin } from "./router.js";

const ADMIN = "https://admin.localhost";
const USER = uuidv7();
const SESSION = uuidv7();
const COOKIE = "__Host-shop_session=gueltig.signatur";
const SET_COOKIE = `${COOKIE}; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax`;
const CLEAR = "__Host-shop_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";

/** Nachgebautes Anmeldemodul: richtiges Passwort „richtig“, gesperrt ist „gesperrt@...“. */
function fakeIdentity() {
  const calls: SignInRequest[] = [];
  const signedOut: (string | undefined)[] = [];
  const identity: IdentityService = {
    createUser: async () => ({ userId: USER }),
    signIn: async (input) => {
      calls.push(input);
      if (input.email.startsWith("gesperrt"))
        return { ok: false, reason: "throttled", retryAfterSeconds: 42 };
      if (input.password !== "richtig") return { ok: false, reason: "invalid_credentials" };
      return {
        ok: true,
        userId: USER,
        sessionId: SESSION,
        email: input.email.toLowerCase(),
        createdAt: new Date("2026-11-06T12:00:00Z"),
        expiresAt: new Date("2026-11-07T00:00:00Z"),
        setCookie: SET_COOKIE,
      };
    },
    getSession: async (cookie) =>
      cookie?.includes(COOKIE) === true
        ? {
            userId: USER,
            sessionId: SESSION,
            email: "inhaberin@teeladen.example",
            createdAt: new Date("2026-11-06T12:00:00Z"),
            expiresAt: new Date("2026-11-07T00:00:00Z"),
          }
        : undefined,
    signOut: async (cookie) => {
      signedOut.push(cookie);
      return { clearCookie: CLEAR };
    },
    close: async () => undefined,
  };
  return { identity, calls, signedOut };
}

const generous = new RateLimiter(
  Object.fromEntries(
    Object.keys(DEFAULT_RATE_LIMITS).map((k) => [k, { limit: 1_000_000, windowMs: 60_000 }]),
  ) as typeof DEFAULT_RATE_LIMITS,
);

let fake: ReturnType<typeof fakeIdentity>;
let app: NestFastifyApplication;
const inject = (opts: InjectOptions) => app.getHttpAdapter().getInstance().inject(opts);

beforeAll(async () => {
  fake = fakeIdentity();
  app = await createApi({
    endpoints: allEndpoints({ database: unconnectedDatabase, identity: fake.identity }),
    resolveActor: sessionResolver(fake.identity),
    logger: createLogger({ level: "silent" }),
    idempotency: memoryIdempotencyStore(),
    rateLimiter: generous,
    allowedOrigins: [ADMIN],
  });
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  fake.calls.length = 0;
  fake.signedOut.length = 0;
});

function signIn(body: unknown, headers: Record<string, string> = {}) {
  return inject({
    method: "POST",
    url: "/auth/v1/sign-in",
    headers: { "content-type": "application/json", origin: ADMIN, ...headers },
    payload: JSON.stringify(body),
  });
}

describe("Herkunftsprüfung (CSRF, Q-14, T-11)", () => {
  const allowed = new Set([ADMIN]);
  it.each([
    ["GET ohne alles", "GET", {}, true],
    ["GET von fremder Seite (lesen ist ungefährlich)", "GET", { origin: "https://evil.example" }, true],
    ["POST von der eigenen Oberfläche", "POST", { origin: ADMIN }, true],
    ["POST von fremder Seite", "POST", { origin: "https://evil.example" }, false],
    ["POST mit Origin null (Sandbox, Weiterleitung)", "POST", { origin: "null" }, false],
    ["POST von Subdomain der eigenen Domain", "POST", { origin: "https://shop.admin.localhost" }, false],
    ["POST über http statt https", "POST", { origin: "http://admin.localhost" }, false],
    ["PATCH mit doppeltem Origin", "PATCH", { origin: [ADMIN, ADMIN] }, false],
    ["DELETE nur mit Sec-Fetch-Site cross-site", "DELETE", { "sec-fetch-site": "cross-site" }, false],
    ["POST nur mit Sec-Fetch-Site same-site", "POST", { "sec-fetch-site": "same-site" }, false],
    ["POST nur mit Sec-Fetch-Site same-origin", "POST", { "sec-fetch-site": "same-origin" }, true],
    ["POST ohne Browser-Kopfzeilen (Skript, App)", "POST", {}, true],
  ])("%s", (_name, method, headers, expected) => {
    expect(isAllowedOrigin(method, headers, allowed)).toBe(expected);
  });

  it("lehnt eine Anmeldung von fremder Seite mit 403 ab, bevor das Passwort geprüft wird", async () => {
    const r = await signIn({ email: "a@b.example", password: "richtig" }, { origin: "https://evil.example" });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("cross_origin_rejected");
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("lehnt eine Änderung in der Admin-API von fremder Seite ab, auch mit gültigem Cookie", async () => {
    const r = await inject({
      method: "POST",
      url: "/admin/v1/manufacturers",
      headers: { "content-type": "application/json", origin: "https://evil.example", cookie: COOKIE },
      payload: JSON.stringify({ name: "Teehaus" }),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("cross_origin_rejected");
  });

  it("Abmelden von fremder Seite geht nicht (niemand kann den Händler hinauswerfen)", async () => {
    const r = await inject({
      method: "POST",
      url: "/auth/v1/sign-out",
      headers: { origin: "https://evil.example", cookie: COOKIE },
    });
    expect(r.statusCode).toBe(403);
    expect(fake.signedOut).toHaveLength(0);
  });
});

describe("Anmelden über die Auth-API", () => {
  it("setzt das Cookie aus dem Anmeldemodul unverändert und gibt Konto und Sitzung zurück", async () => {
    const r = await signIn(
      { email: "Inhaberin@Teeladen.example", password: "richtig" },
      { "user-agent": "Vitest/1.0", cookie: "__Host-shop_session=alt.sig" },
    );
    expect(r.statusCode).toBe(200);
    expect(r.headers["set-cookie"]).toEqual([SET_COOKIE]);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json()).toEqual({
      user: { id: USER, email: "inhaberin@teeladen.example" },
      session: { id: SESSION, createdAt: "2026-11-06T12:00:00.000Z", expiresAt: "2026-11-07T00:00:00.000Z" },
    });
    // Das Token steht nie im Inhalt.
    expect(r.body).not.toContain("gueltig");
    // Adresse vom Webserver, nicht aus einer Kopfzeile des Clients; Browser-Kennung wird weitergegeben.
    expect(fake.calls[0]).toMatchObject({ ipAddress: "127.0.0.1", userAgent: "Vitest/1.0" });
    // Die alte Sitzung dieses Browsers wird beendet (neue Sitzungs-ID bei jeder Anmeldung).
    expect(fake.signedOut).toEqual(["__Host-shop_session=alt.sig"]);
  });

  it("falsches Passwort: 401 invalid_credentials, kein Cookie", async () => {
    const r = await signIn({ email: "inhaberin@teeladen.example", password: "falsch" });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe("invalid_credentials");
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("ungültige E-Mail bekommt dieselbe Antwort wie ein falsches Passwort (T-10)", async () => {
    const a = await signIn({ email: "kein at", password: "falsch" });
    const b = await signIn({ email: "inhaberin@teeladen.example", password: "falsch" });
    expect(a.statusCode).toBe(b.statusCode);
    expect({ ...a.json(), requestId: "" }).toEqual({ ...b.json(), requestId: "" });
  });

  it("Bremse: 429 mit Retry-After (T-10)", async () => {
    const r = await signIn({ email: "gesperrt@teeladen.example", password: "richtig" });
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBe("42");
    expect(r.json().code).toBe("rate_limited");
  });

  it("unbekannte Felder ergeben 422 (kein Mitschicken von Rollen o. Ä.)", async () => {
    const r = await signIn({ email: "a@b.example", password: "richtig", role: "owner" });
    expect(r.statusCode).toBe(422);
    expect(fake.calls).toHaveLength(0);
  });

  it("nimmt keinen Idempotency-Key an (ein Passwort gehört nie in einen Speicher)", async () => {
    const r = await signIn(
      { email: "a@b.example", password: "richtig" },
      { "idempotency-key": "schluessel-123" },
    );
    // Der Schlüssel wird ignoriert, die Anmeldung läuft normal.
    expect(r.statusCode).toBe(200);
    expect(r.headers["idempotent-replayed"]).toBeUndefined();
  });
});

describe("Sitzung und Abmelden", () => {
  it("„Wer bin ich“ ohne Cookie: 401", async () => {
    const r = await inject({ method: "GET", url: "/auth/v1/session" });
    expect(r.statusCode).toBe(401);
  });

  it("„Wer bin ich“ mit gültigem Cookie: Konto und Sitzung", async () => {
    const r = await inject({ method: "GET", url: "/auth/v1/session", headers: { cookie: `x=1; ${COOKIE}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toEqual({ id: USER, email: "inhaberin@teeladen.example" });
  });

  it("Abmelden löscht das Cookie, auch ohne Sitzung", async () => {
    for (const cookie of [COOKIE, undefined]) {
      const r = await inject({
        method: "POST",
        url: "/auth/v1/sign-out",
        headers: { origin: ADMIN, ...(cookie === undefined ? {} : { cookie }) },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ signedOut: true });
      expect(r.headers["set-cookie"]).toEqual([CLEAR]);
    }
  });

  it("angemeldet, aber ohne Mitgliedschaft: Admin-API antwortet 403 (Rollen folgen in E6 Teil 3)", async () => {
    const r = await inject({ method: "GET", url: "/admin/v1/manufacturers", headers: { cookie: COOKIE } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("forbidden");
  });
});

describe("Allgemeine Anfragebremse für die Anmeldung (Sicherheit 5.8)", () => {
  it("höchstens 5 Anmeldeversuche je Minute und Netz, unabhängig vom Konto", async () => {
    const f = fakeIdentity();
    const strict = await createApi({
      endpoints: allEndpoints({ database: unconnectedDatabase, identity: f.identity }),
      resolveActor: sessionResolver(f.identity),
      logger: createLogger({ level: "silent" }),
      idempotency: memoryIdempotencyStore(),
      allowedOrigins: [ADMIN],
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const r = await strict
          .getHttpAdapter()
          .getInstance()
          .inject({
            method: "POST",
            url: "/auth/v1/sign-in",
            headers: { "content-type": "application/json", origin: ADMIN },
            payload: JSON.stringify({ email: `k${i}@x.example`, password: "falsch" }),
          });
        statuses.push(r.statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
      expect(f.calls).toHaveLength(5);
    } finally {
      await strict.close();
    }
  });
});
