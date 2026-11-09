// Berechtigungen (Scopes) der APIs (Architektur 4.4, Sicherheit 5.3). Form `<bereich>:<read|write>`.
// Die Liste ist geschlossen: Ein Endpunkt kann nur Berechtigungen verlangen, die hier stehen.
// Neue Bereiche kommen mit den Modulen dazu, die sie brauchen.

export const SCOPES = [
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
  "audit:read",
  // API-Token des Shops ansehen und anlegen oder widerrufen (E6 Teil 5). Nur die Inhaberin.
  "api_tokens:read",
  "api_tokens:write",
  // Mitarbeiter einladen, auflisten und entfernen (E6 Teil 7). Nur die Inhaberin.
  "members:read",
  "members:write",
  "platform:read",
  "platform:write",
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
