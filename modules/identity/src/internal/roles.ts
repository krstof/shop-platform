// Systemrollen der Händler (Sicherheit 5.3, SIC-03, E6 Teil 3). Sie stehen im Code, nicht in der
// Datenbank; eigene Rollen eines Shops (identity.role) kommen erst mit Welle 5.
//
// Standard ist „verboten“: Jede Berechtigung der Admin-API muss hier bewusst einer Gruppe
// zugeordnet sein. Kommt in @shop/http ein neuer Bereich dazu, scheitert der Test roles.test.ts,
// bis jemand entschieden hat, ob Mitarbeiter ihn bekommen.
import { SCOPES, type Scope } from "@shop/http";

export const SYSTEM_ROLES = ["owner", "staff"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export function isSystemRole(value: string): value is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(value);
}

/** Berechtigungen der Platform-API. Keine Händlerrolle bekommt sie, nur das Betreiberkonto. */
export const PLATFORM_SCOPES: readonly Scope[] = ["platform:read", "platform:write"];

/**
 * Was Mitarbeiter (`staff`) dürfen. Laut Sicherheit 5.3: alles außer Mitarbeiter verwalten,
 * API-Token, Shop löschen und Zahlungseinstellungen. Diese Bereiche gibt es noch nicht als
 * Berechtigung; sie kommen mit ihren Modulen und landen dann in OWNER_ONLY_SCOPES.
 */
export const STAFF_SCOPES: readonly Scope[] = [
  "products:read",
  "products:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "customers:write",
  "content:read",
  "content:write",
  "settings:read",
  "settings:write",
  // Änderungsprotokoll lesen: ja, es zeigt nur, wer was im eigenen Shop geändert hat (FRAGEN.md).
  "audit:read",
];

/** Nur die Inhaberin oder der Inhaber. Heute leer, siehe STAFF_SCOPES. */
export const OWNER_ONLY_SCOPES: readonly Scope[] = [];

/** Alle Berechtigungen, die ein Shop überhaupt vergeben kann (alles außer Platform-API). */
export const MERCHANT_SCOPES: readonly Scope[] = SCOPES.filter((s) => !PLATFORM_SCOPES.includes(s));

const ROLE_SCOPES: Readonly<Record<SystemRole, ReadonlySet<Scope>>> = {
  owner: new Set([...STAFF_SCOPES, ...OWNER_ONLY_SCOPES]),
  staff: new Set(STAFF_SCOPES),
};

/** Berechtigungen einer Systemrolle. Unbekannte Rollen bekommen nichts (geschlossen). */
export function scopesForRole(role: string): ReadonlySet<Scope> {
  return isSystemRole(role) ? ROLE_SCOPES[role] : new Set();
}
