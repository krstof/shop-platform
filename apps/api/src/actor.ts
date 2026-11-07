// Wer fragt an, und für welchen Shop? (Architektur 4.4 und 5.3, Sicherheit 5.3)
// Seit E6 Teil 2 kommt der Akteur aus dem Sitzungs-Cookie (Modul identity), seit E6 Teil 3 auch
// Shop und Berechtigungen: Die Oberfläche schickt die Kopfzeile `Shop-Id` mit; sie gilt nur, wenn
// das Konto dort eine aktive Mitgliedschaft hat und der Shop aktiv ist. Dann kommen die
// Berechtigungen aus der Rolle (owner oder staff). Sonst bleibt die Sitzung ohne Shop und ohne
// Berechtigungen, und die Admin-API antwortet 403. Ob es den Shop gibt, verrät die Antwort nicht.
// Betreiberkonten (Platform-API, mit Zwei-Faktor) und API-Token folgen in späteren Teilen von E6.
// Tests setzen eine eigene Auflösung ein.
import type { AuthenticatedActor } from "@shop/http";
import {
  scopesForRole,
  type IdentityService,
  type MembershipDirectory,
  type ShopOfUser,
} from "@shop/identity";
import { isUuid } from "@shop/kernel";
import type { ShopDirectory } from "@shop/platform";

export interface RequestHeaders {
  readonly [name: string]: string | string[] | undefined;
}

/** Ermittelt den Akteur einer Anfrage. `undefined` heißt: nicht angemeldet. */
export type ActorResolver = (request: {
  readonly headers: RequestHeaders;
}) => Promise<AuthenticatedActor | undefined>;

export const nobodyResolver: ActorResolver = async () => undefined;

/** Kopfzeile, mit der Backoffice und Shop-Editor den Shop wählen (Architektur 4.2). */
export const SHOP_ID_HEADER = "shop-id";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join("; ") : value;
}

/** Shop-Id nur, wenn sie genau einmal und als UUID kommt. Alles andere zählt wie „kein Shop“. */
export function requestedShopId(headers: RequestHeaders): string | undefined {
  const raw = headers[SHOP_ID_HEADER];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  return isUuid(value) ? value : undefined;
}

export interface SessionResolverDependencies {
  readonly identity: Pick<IdentityService, "getSession">;
  readonly memberships: Pick<MembershipDirectory, "findMembership">;
  readonly shops: Pick<ShopDirectory, "getShops">;
}

/** Akteur aus dem Sitzungs-Cookie. Abgelaufene, beendete oder gefälschte Sitzungen ergeben `undefined`. */
export function sessionResolver(deps: SessionResolverDependencies): ActorResolver {
  return async ({ headers }) => {
    const session = await deps.identity.getSession(single(headers["cookie"]));
    if (session === undefined) return undefined;
    const signedIn: AuthenticatedActor = { actor: { type: "user", id: session.userId }, scopes: new Set() };
    const shopId = requestedShopId(headers);
    if (shopId === undefined) return signedIn;
    const membership = await deps.memberships.findMembership(session.userId, shopId);
    if (membership === undefined) return signedIn;
    const [shop] = await deps.shops.getShops([shopId]);
    if (shop?.status !== "active") return signedIn;
    return { ...signedIn, tenantId: shopId, scopes: scopesForRole(membership.role) };
  };
}

export interface ShopsOfUserDependencies {
  readonly memberships: Pick<MembershipDirectory, "listMemberships">;
  readonly shops: Pick<ShopDirectory, "getShops">;
}

/** Shops für „Wer bin ich“: nur aktive Mitgliedschaften in aktiven Shops, dieselbe Regel wie oben. */
export function shopsOfUser(deps: ShopsOfUserDependencies): (userId: string) => Promise<ShopOfUser[]> {
  return async (userId) => {
    const memberships = await deps.memberships.listMemberships(userId);
    if (memberships.length === 0) return [];
    const shops = new Map(
      (await deps.shops.getShops(memberships.map((m) => m.tenantId))).map((s) => [s.id, s]),
    );
    return memberships.flatMap((m) => {
      const s = shops.get(m.tenantId);
      return s?.status === "active" ? [{ id: s.id, handle: s.handle, name: s.name, role: m.role }] : [];
    });
  };
}
