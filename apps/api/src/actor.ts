// Wer fragt an, und für welchen Shop? (Architektur 4.4 und 5.3, Sicherheit 5.3)
// Seit E6 Teil 2 kommt der Akteur aus dem Sitzungs-Cookie (Modul identity), seit E6 Teil 3 auch
// Shop und Berechtigungen: Die Oberfläche schickt die Kopfzeile `Shop-Id` mit; sie gilt nur, wenn
// das Konto dort eine aktive Mitgliedschaft hat und der Shop aktiv ist. Dann kommen die
// Berechtigungen aus der Rolle (owner oder staff). Sonst bleibt die Sitzung ohne Shop und ohne
// Berechtigungen, und die Admin-API antwortet 403. Ob es den Shop gibt, verrät die Antwort nicht.
// Seit E6 Teil 4 auch Betreiberkonten: Ohne Shop-Id bekommt ein aktives Betreiberkonto die
// Berechtigungen der Platform-API, aber nur mit bestätigtem zweitem Faktor (ADR-011).
// Seit E6 Teil 5 auch API-Token (`Authorization: Bearer shp_at_…`): Das Token bestimmt den Shop,
// die Berechtigungen sind die Schnittmenge aus Token und Rolle des Kontos, das es angelegt hat.
// Kommt eine Kopfzeile Authorization, zählt nur sie; ein Cookie daneben wird nicht beachtet.
// Tests setzen eine eigene Auflösung ein.
import type { AuthenticatedActor, Scope } from "@shop/http";
import {
  scopesForRole,
  type ApiTokenService,
  type IdentityService,
  type MembershipDirectory,
  type ShopOfUser,
} from "@shop/identity";
import { isUuid } from "@shop/kernel";
import type { OperatorDirectory, OperatorRole, ShopDirectory } from "@shop/platform";

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
  readonly operators: Pick<OperatorDirectory, "findOperator">;
}

/** Berechtigungen der Platform-API je Betreiberrolle (Sicherheit 5.3). */
export function platformScopesForRole(role: OperatorRole): ReadonlySet<Scope> {
  return role === "owner" || role === "operator"
    ? new Set<Scope>(["platform:read", "platform:write"])
    : new Set<Scope>(["platform:read"]);
}

/** Akteur aus dem Sitzungs-Cookie. Abgelaufene, beendete oder gefälschte Sitzungen ergeben `undefined`. */
export function sessionResolver(deps: SessionResolverDependencies): ActorResolver {
  return async ({ headers }) => {
    const session = await deps.identity.getSession(single(headers["cookie"]));
    if (session === undefined) return undefined;
    const signedIn: AuthenticatedActor = {
      actor: { type: "user", id: session.userId },
      scopes: new Set(),
      passwordConfirmedAt: session.passwordConfirmedAt,
    };
    const shopId = requestedShopId(headers);
    if (shopId === undefined) {
      // Platform-API: nur Betreiber, nur mit bestätigtem zweitem Faktor.
      if (session.secondFactor !== "verified") return signedIn;
      const operator = await deps.operators.findOperator(session.userId);
      return operator === undefined
        ? signedIn
        : { ...signedIn, scopes: platformScopesForRole(operator.role) };
    }
    const membership = await deps.memberships.findMembership(session.userId, shopId);
    if (membership === undefined) return signedIn;
    const [shop] = await deps.shops.getShops([shopId]);
    if (shop?.status !== "active") return signedIn;
    return { ...signedIn, tenantId: shopId, scopes: scopesForRole(membership.role) };
  };
}

/**
 * Token aus `Authorization: Bearer …`. `undefined`: keine solche Kopfzeile. `null`: Kopfzeile da,
 * aber unbrauchbar (anderes Verfahren, mehrfach, leer). Dann gilt die Anfrage als nicht angemeldet.
 */
export function bearerToken(headers: RequestHeaders): string | null | undefined {
  const raw = headers["authorization"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]{1,200})$/i.exec(raw.trim());
  return match?.[1] ?? null;
}

export interface ApiTokenResolverDependencies {
  readonly tokens: Pick<ApiTokenService, "authenticate">;
  readonly shops: Pick<ShopDirectory, "getShops">;
}

/** Akteur aus einem API-Token. Ungültig, widerrufen, abgelaufen oder Shop nicht aktiv: `undefined`. */
export function apiTokenResolver(deps: ApiTokenResolverDependencies): ActorResolver {
  return async ({ headers }) => {
    const token = bearerToken(headers);
    if (token === undefined || token === null) return undefined;
    const t = await deps.tokens.authenticate(token);
    if (t === undefined) return undefined;
    const [shop] = await deps.shops.getShops([t.tenantId]);
    if (shop?.status !== "active") return undefined;
    const actor: AuthenticatedActor = { actor: { type: "api_token", id: t.tokenId }, scopes: new Set() };
    // Eine Shop-Id, die nicht zum Token passt, führt zu 403 statt still den Shop zu wechseln.
    const shopId = requestedShopId(headers);
    if (headers[SHOP_ID_HEADER] !== undefined && shopId !== t.tenantId) return actor;
    return { ...actor, tenantId: t.tenantId, scopes: t.scopes };
  };
}

/** Sitzung oder API-Token: Mit Kopfzeile Authorization zählt nur das Token. */
export function requestResolver(session: ActorResolver, apiToken: ActorResolver): ActorResolver {
  return async (request) =>
    request.headers["authorization"] === undefined ? session(request) : apiToken(request);
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
