// Wer fragt an? (Architektur 4.4, Sicherheit 5.3)
// Die echte Prüfung von Sitzungs-Cookie und API-Token kommt mit dem Modul identity (E6).
// Bis dahin gilt die sichere Voreinstellung: niemand ist angemeldet, jede geschützte Anfrage
// ergibt 401. Tests setzen eine eigene Auflösung ein.
import type { AuthenticatedActor } from "@shop/http";

export interface RequestHeaders {
  readonly [name: string]: string | string[] | undefined;
}

/** Ermittelt den Akteur einer Anfrage. `undefined` heißt: nicht angemeldet. */
export type ActorResolver = (request: {
  readonly headers: RequestHeaders;
}) => Promise<AuthenticatedActor | undefined>;

export const nobodyResolver: ActorResolver = async () => undefined;
