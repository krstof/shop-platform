// Wer fragt an? (Architektur 4.4, Sicherheit 5.3)
// Seit E6 Teil 2 kommt der Akteur aus dem Sitzungs-Cookie (Modul identity). Mitgliedschaften
// und Rollen folgen in E6 Teil 3; bis dahin hat eine Sitzung weder Shop noch Berechtigungen.
// Admin- und Platform-API antworten Angemeldeten also mit 403, nur „Wer bin ich“ und
// Abmelden funktionieren. API-Token folgen ebenfalls später. Tests setzen eine eigene Auflösung ein.
import type { AuthenticatedActor } from "@shop/http";
import type { IdentityService } from "@shop/identity";

export interface RequestHeaders {
  readonly [name: string]: string | string[] | undefined;
}

/** Ermittelt den Akteur einer Anfrage. `undefined` heißt: nicht angemeldet. */
export type ActorResolver = (request: {
  readonly headers: RequestHeaders;
}) => Promise<AuthenticatedActor | undefined>;

export const nobodyResolver: ActorResolver = async () => undefined;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join("; ") : value;
}

/** Akteur aus dem Sitzungs-Cookie. Abgelaufene, beendete oder gefälschte Sitzungen ergeben `undefined`. */
export function sessionResolver(identity: Pick<IdentityService, "getSession">): ActorResolver {
  return async ({ headers }) => {
    const session = await identity.getSession(single(headers["cookie"]));
    if (session === undefined) return undefined;
    return { actor: { type: "user", id: session.userId }, scopes: new Set() };
  };
}
