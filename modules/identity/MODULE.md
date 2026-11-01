# Modul `identity`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Anmeldung, Sitzungen, Zwei-Faktor, Mitgliedschaften und Rollen, API-Token. Anmeldedaten nur über die Rolle shop_auth (ADR-008).

**Welle:** 1

**Datenbankschema:** `identity`, Tabellen: `user`, `account`, `session`, `verification`, `two_factor`, `passkey`, `role`, `role_permission`, `membership`, `api_token`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** getActor(token), assertPermission(actor, permission), listMemberships(userId), createApiToken(...)

**Ereignisse (geplant):** identity.user.registered.v1, identity.login.failed.v1, identity.membership.changed.v1
