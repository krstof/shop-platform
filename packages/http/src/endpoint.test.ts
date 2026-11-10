import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEndpoint, EndpointDefinitionError, findLooseObjects, type EndpointSpec } from "./endpoint.js";
import { idParam } from "./schemas.js";

type AnySpec = EndpointSpec<
  z.ZodObject | undefined,
  z.ZodObject | undefined,
  z.ZodType | undefined,
  z.ZodType
>;

const base = {
  api: "admin",
  method: "GET",
  path: "/things/{thingId}",
  operationId: "getThing",
  summary: "Ding lesen",
  description: "Liest ein Ding des eigenen Shops.",
  tags: ["Dinge"],
  access: { scopes: ["products:read"] },
  params: z.strictObject({ thingId: idParam }),
  response: { status: 200, description: "Das Ding", schema: z.object({ id: z.string() }) },
  handler: async () => ({ id: "x" }),
} satisfies AnySpec;

/** Storefront-Endpunkte haben den Shop immer im Pfad (M4). */
const storePath = {
  path: "/shops/{shopHandle}/things/{thingId}",
  params: z.strictObject({ shopHandle: z.string(), thingId: idParam }),
};

function problems(overrides: Partial<Record<keyof AnySpec, unknown>>): string {
  try {
    defineEndpoint({ ...base, ...overrides } as AnySpec);
    return "";
  } catch (e) {
    expect(e).toBeInstanceOf(EndpointDefinitionError);
    return (e as Error).message;
  }
}

describe("defineEndpoint", () => {
  it("nimmt einen gültigen Endpunkt an und setzt den vollen Pfad", () => {
    const e = defineEndpoint(base);
    expect(e.fullPath).toBe("/admin/v1/things/{thingId}");
    expect(Object.isFrozen(e)).toBe(true);
  });

  it.each([
    ["fehlende Berechtigung", { access: { scopes: [] } }, "Berechtigung fehlt"],
    ["gar keine Angabe zur Berechtigung", { access: {} }, "Berechtigung fehlt"],
    ["unbekannte Berechtigung", { access: { scopes: ["products:delete"] } }, "unbekannte Berechtigung"],
    ["doppelte Berechtigung", { access: { scopes: ["products:read", "products:read"] } }, "doppelte"],
    [
      "öffentlicher Admin-Endpunkt",
      { access: { public: true, reason: "weil es bequem ist" } },
      "nur die Storefront- und die Auth-API",
    ],
    ["signedIn in der Admin-API", { access: { signedIn: true } }, "signedIn ohne Berechtigung gibt es nur"],
    [
      "Berechtigungen in der Auth-API",
      { api: "auth", access: { scopes: ["products:read"] } },
      "die Auth-API kennt keine Berechtigungen",
    ],
    [
      "public und signedIn zugleich",
      { api: "auth", access: { public: true, signedIn: true, reason: "Anmelden geht ohne Sitzung." } },
      "schließen sich aus",
    ],
    [
      "POST der Auth-API mit Idempotenz",
      {
        api: "auth",
        method: "POST",
        path: "/sign-in",
        params: undefined,
        access: { public: true, reason: "Anmelden geht ohne Sitzung." },
        body: z.strictObject({ email: z.string() }),
        bodyExample: { email: "a@b.example" },
      },
      'braucht idempotency: "none"',
    ],
    ["öffentlich ohne Begründung", { api: "store", access: { public: true, reason: "" } }, "Begründung"],
    ["operationId nicht camelCase", { operationId: "Get_Thing" }, "camelCase"],
    ["Platzhalter ohne Schema", { params: z.strictObject({}) }, "Platzhalter ohne Schema"],
    [
      "Schemafeld ohne Platzhalter",
      { params: z.strictObject({ thingId: idParam, other: idParam }) },
      "ohne Platzhalter",
    ],
    ["Pfad nicht kebab-case", { path: "/Things/{thingId}" }, "ungültige Pfadteile"],
    ["Pfad mit Schrägstrich am Ende", { path: "/things/" }, "darf nicht mit / enden"],
    ["GET mit body", { body: z.strictObject({ a: z.string() }) }, "GET darf keinen body"],
    ["lockeres Pfad-Schema", { params: z.object({ thingId: idParam }) }, "/params: Objekt ist nicht streng"],
    [
      "lockeres Objekt tief im body",
      {
        method: "POST",
        path: "/things",
        params: undefined,
        body: z.strictObject({ items: z.array(z.object({ name: z.string() })).optional() }),
        bodyExample: {},
      },
      "/body/items/0: Objekt ist nicht streng",
    ],
    [
      "body ohne Beispiel",
      { method: "POST", path: "/things", params: undefined, body: z.strictObject({ name: z.string() }) },
      "bodyExample fehlt",
    ],
    [
      "Beispiel passt nicht zum body",
      {
        method: "POST",
        path: "/things",
        params: undefined,
        body: z.strictObject({ name: z.string() }),
        bodyExample: { name: 1 },
      },
      "bodyExample passt nicht",
    ],
    ["Idempotenz bei GET", { idempotency: "required" }, "idempotency gibt es nur bei POST"],
    ["If-Match bei GET", { ifMatch: "required" }, "ifMatch gibt es nur bei PATCH"],
    ["unbekannter Bremsbereich", { rateLimit: "turbo" }, "unbekannter Bereich der Anfragebremse"],
  ])("lehnt ab: %s", (_name, overrides, message) => {
    expect(problems(overrides)).toContain(message);
  });

  it("setzt Voreinstellungen: Idempotenz bei POST erlaubt, Bremsbereich nach API", () => {
    const get = defineEndpoint(base);
    expect([get.idempotency, get.rateLimit, get.ifMatch]).toEqual(["none", "admin", undefined]);
    const post = defineEndpoint({
      ...base,
      method: "POST",
      path: "/things",
      operationId: "createThing",
      params: undefined,
      body: z.strictObject({ name: z.string() }),
      bodyExample: { name: "Tee" },
    } as AnySpec);
    expect([post.idempotency, post.rateLimit]).toEqual(["optional", "admin"]);
    const store = defineEndpoint({
      ...base,
      ...storePath,
      api: "store",
      access: { public: true, reason: "Für alle sichtbar." },
    } as AnySpec);
    expect(store.rateLimit).toBe("store-read");
    const signIn = defineEndpoint({
      ...base,
      api: "auth",
      method: "POST",
      path: "/sign-in",
      operationId: "signIn",
      params: undefined,
      access: { public: true, reason: "Anmelden geht nur ohne Sitzung." },
      body: z.strictObject({ email: z.string() }),
      bodyExample: { email: "a@b.example" },
      idempotency: "none",
    } as AnySpec);
    expect([signIn.fullPath, signIn.rateLimit, signIn.idempotency]).toEqual([
      "/auth/v1/sign-in",
      "login",
      "none",
    ]);
    const me = defineEndpoint({
      ...base,
      api: "auth",
      path: "/session",
      operationId: "getSession",
      params: undefined,
      access: { signedIn: true },
    } as AnySpec);
    expect(me.rateLimit).toBe("admin");
  });

  it("erlaubt öffentliche Endpunkte nur in der Storefront-API mit Begründung", () => {
    expect(
      problems({
        ...storePath,
        api: "store",
        access: { public: true, reason: "Produktseite ist für alle sichtbar." },
      }),
    ).toBe("");
  });

  it("Storefront-API: der Shop steht immer im Pfad", () => {
    expect(
      problems({ api: "store", access: { public: true, reason: "Produktseite ist für alle sichtbar." } }),
    ).toContain("/shops/{shopHandle}");
  });
});

describe("findLooseObjects", () => {
  it("findet lockere Objekte in Union, Intersection, Record, Pipe und Default", () => {
    const loose = z.object({ x: z.string() });
    const found = findLooseObjects(
      z.strictObject({
        u: z.union([z.string(), loose]),
        i: z.intersection(z.strictObject({ a: z.string() }), loose),
        r: z.record(z.string(), loose),
        p: loose.transform((v) => v.x),
        d: loose.default({ x: "a" }),
        n: z.strictObject({ deep: z.strictObject({ ok: z.number() }) }),
      }),
    );
    expect(found.map((f) => f.split(":")[0])).toEqual(["/u", "/i", "/r/*", "/p", "/d"]);
  });

  it("ist bei durchgehend strengen Schemas leer", () => {
    expect(findLooseObjects(z.strictObject({ a: z.array(z.strictObject({ b: z.string() })) }))).toEqual([]);
  });
});
