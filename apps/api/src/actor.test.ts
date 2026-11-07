// Shop-Auswahl und Rollen (E6 Teil 3, Sicherheit 5.3): Die Kopfzeile Shop-Id gilt nur mit aktiver
// Mitgliedschaft in einem aktiven Shop. Alles andere ergibt eine Sitzung ohne Shop und ohne Rechte.
import type { ActiveSession, Membership } from "@shop/identity";
import { uuidv7 } from "@shop/kernel";
import type { OperatorRole, ShopSummary, TenantStatus } from "@shop/platform";
import { describe, expect, it } from "vitest";
import { requestedShopId, sessionResolver, shopsOfUser, type RequestHeaders } from "./actor.js";

const USER = uuidv7();
const OWN = uuidv7();
const STAFF_SHOP = uuidv7();
const FOREIGN = uuidv7();
const SUSPENDED = uuidv7();
const COOKIE = "__Host-shop_session=gueltig.sig";

const session: ActiveSession = {
  userId: USER,
  sessionId: uuidv7(),
  email: "inhaberin@teeladen.example",
  createdAt: new Date(),
  expiresAt: new Date(),
  secondFactor: "not_enrolled",
};

const memberships: Membership[] = [
  { tenantId: OWN, role: "owner" },
  { tenantId: STAFF_SHOP, role: "staff" },
  { tenantId: SUSPENDED, role: "owner" },
];

const shopStatus: Record<string, TenantStatus> = {
  [OWN]: "active",
  [STAFF_SHOP]: "active",
  [FOREIGN]: "active",
  [SUSPENDED]: "suspended",
};

function deps(options: { secondFactor?: ActiveSession["secondFactor"]; operatorRole?: OperatorRole } = {}) {
  const calls: string[] = [];
  const s: ActiveSession = { ...session, secondFactor: options.secondFactor ?? session.secondFactor };
  return {
    calls,
    identity: {
      getSession: async (cookie: string | undefined) => (cookie === COOKIE ? s : undefined),
    },
    operators: {
      findOperator: async (userId: string) => {
        calls.push("operator");
        return userId === USER && options.operatorRole !== undefined
          ? { userId, role: options.operatorRole }
          : undefined;
      },
    },
    memberships: {
      findMembership: async (userId: string, tenantId: string) => {
        calls.push(`membership:${tenantId}`);
        return memberships.find((m) => userId === USER && m.tenantId === tenantId);
      },
      listMemberships: async (userId: string) => (userId === USER ? memberships : []),
    },
    shops: {
      getShops: async (ids: readonly string[]): Promise<ShopSummary[]> =>
        ids.flatMap((id) => {
          const status = shopStatus[id];
          return status === undefined
            ? []
            : [{ id, handle: `shop-${id.slice(-4)}`, name: "Teeladen", status }];
        }),
    },
  };
}

const resolve = (headers: RequestHeaders) => sessionResolver(deps())({ headers });

describe("Shop-Id und Mitgliedschaft (Architektur 4.2, Sicherheit 5.3)", () => {
  it("ohne Sitzung kein Akteur, auch mit Shop-Id", async () => {
    expect(await resolve({ "shop-id": OWN })).toBeUndefined();
  });

  it("ohne Shop-Id: angemeldet, aber ohne Shop und ohne Berechtigungen", async () => {
    const a = await resolve({ cookie: COOKIE });
    expect(a?.actor).toEqual({ type: "user", id: USER });
    expect(a?.tenantId).toBeUndefined();
    expect(a?.scopes.size).toBe(0);
  });

  it("Inhaberin im eigenen Shop: Shop gesetzt, alle Berechtigungen des Shops", async () => {
    const a = await resolve({ cookie: COOKIE, "shop-id": OWN });
    expect(a?.tenantId).toBe(OWN);
    expect(a?.scopes.has("products:write")).toBe(true);
    expect(a?.scopes.has("platform:read")).toBe(false);
  });

  it("Mitarbeiterin bekommt die Berechtigungen von staff", async () => {
    const a = await resolve({ cookie: COOKIE, "shop-id": STAFF_SHOP });
    expect(a?.tenantId).toBe(STAFF_SHOP);
    expect(a?.scopes.has("orders:write")).toBe(true);
  });

  it.each([
    ["fremder Shop (keine Mitgliedschaft)", FOREIGN],
    ["gesperrter Shop", SUSPENDED],
    ["unbekannter Shop", uuidv7()],
    ["keine UUID", "teeladen"],
    ["SQL im Kopf", "' OR 1=1 --"],
    ["leer", ""],
  ])("%s: kein Shop, keine Berechtigungen", async (_name, shopId) => {
    const a = await resolve({ cookie: COOKIE, "shop-id": shopId });
    expect(a?.actor.id).toBe(USER);
    expect(a?.tenantId).toBeUndefined();
    expect(a?.scopes.size).toBe(0);
  });

  it("doppelte Shop-Id gilt nicht (kein Raten, welche gemeint ist)", async () => {
    const a = await resolve({ cookie: COOKIE, "shop-id": [OWN, OWN] });
    expect(a?.tenantId).toBeUndefined();
  });

  it("ungültige Shop-Id fragt die Datenbank gar nicht erst", async () => {
    const d = deps();
    await sessionResolver(d)({ headers: { cookie: COOKIE, "shop-id": "kein-shop" } });
    expect(d.calls).toEqual([]);
  });

  it("Groß- und Kleinschreibung der UUID und Leerzeichen sind egal", () => {
    expect(requestedShopId({ "shop-id": `  ${OWN.toUpperCase()} ` })).toBe(OWN);
  });
});

describe("Betreiberkonto und Platform-API (E6 Teil 4, ADR-011)", () => {
  const platform = (o: Parameters<typeof deps>[0]) =>
    sessionResolver(deps(o))({ headers: { cookie: COOKIE } });

  it("Betreiber mit bestätigtem zweitem Faktor: Berechtigungen der Platform-API, kein Shop", async () => {
    const a = await platform({ secondFactor: "verified", operatorRole: "owner" });
    expect([...(a?.scopes ?? [])].sort()).toEqual(["platform:read", "platform:write"]);
    expect(a?.tenantId).toBeUndefined();
  });

  it("Rollen support und viewer dürfen nur lesen", async () => {
    for (const role of ["support", "viewer"] as const) {
      const a = await platform({ secondFactor: "verified", operatorRole: role });
      expect([...(a?.scopes ?? [])]).toEqual(["platform:read"]);
    }
  });

  it("Betreiber ohne eingerichteten zweiten Faktor: angemeldet, aber ohne Platform-Rechte", async () => {
    const d = deps({ secondFactor: "not_enrolled", operatorRole: "owner" });
    const a = await sessionResolver(d)({ headers: { cookie: COOKIE } });
    expect(a?.scopes.size).toBe(0);
    // Ohne zweiten Faktor wird gar nicht erst nachgesehen.
    expect(d.calls).toEqual([]);
  });

  it("bestätigter zweiter Faktor allein macht niemanden zum Betreiber", async () => {
    const a = await platform({ secondFactor: "verified" });
    expect(a?.scopes.size).toBe(0);
  });

  it("Betreiber mit Shop-Id bekommt nur die Rechte im Shop, nie platform:*", async () => {
    const a = await sessionResolver(deps({ secondFactor: "verified", operatorRole: "owner" }))({
      headers: { cookie: COOKIE, "shop-id": OWN },
    });
    expect(a?.tenantId).toBe(OWN);
    expect(a?.scopes.has("platform:read")).toBe(false);
  });
});

describe("Shops für „Wer bin ich“", () => {
  it("nur aktive Shops, mit Rolle, in der Reihenfolge der Mitgliedschaften", async () => {
    const list = await shopsOfUser(deps())(USER);
    expect(list.map((s) => [s.id, s.role])).toEqual([
      [OWN, "owner"],
      [STAFF_SHOP, "staff"],
    ]);
  });

  it("ohne Mitgliedschaft eine leere Liste", async () => {
    expect(await shopsOfUser(deps())(uuidv7())).toEqual([]);
  });
});
