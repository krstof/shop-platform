# Modul `identity`

> Landkarte für spätere Läufe (Architektur 8.4). Stand: E6 Teil 1 (06.11.2026).

**Aufgabe:** Anmeldung, Sitzungen, Zwei-Faktor, Mitgliedschaften und Rollen, API-Token. Anmeldedaten nur über die Rolle shop_auth (ADR-008).

**Welle:** 1

**Datenbankschema:** `identity`, Tabellen: `user`, `account`, `session`, `verification`, `two_factor`, `passkey`, `role`, `role_permission`, `membership`, `api_token`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (heute):** `createIdentityService(options)` liefert `createUser`, `signIn`, `getSession`, `signOut`, `close`. Dazu `checkNewPassword` und die Konstanten zum Cookie und zur Sitzungsdauer.

**Fassade (geplant):** getActor(token), assertPermission(actor, permission), listMemberships(userId), createApiToken(...)

**Aufbau innen** (`src/internal/`):
- `auth.ts`: Better Auth 1.7.14 (fest), nur E-Mail und Passwort, keine Selbst-Registrierung, keine Plugins, eingebaute Bremse aus, eigener Pool als `shop_auth`, Cookie `__Host-shop_session`, kein Sitzungs-Cache im Cookie.
- `hashed-session-adapter.ts`: Hülle um den Datenbank-Adapter, speichert Sitzungs-Token nur als SHA-256 (ADR-010).
- `password.ts`: Argon2id (19 MiB, 2 Durchläufe, Parallelität 1), Passwortregeln nach NIST, Liste häufiger Passwörter in `data/`.
- `identity-service.ts`: eigene Schnittstelle, damit niemand außerhalb Better Auth kennt. Höchstdauer der Sitzung (7 Tage) prüft sie selbst.

**Bewusst noch nicht da:** HTTP-Endpunkte (kommen mit der eigenen Bremse in Teil 2, vorher wäre Raten ungebremst möglich), Einladungen, Passwort vergessen, Zwei-Faktor, Mitgliedschaften, API-Token.

**Tests:** `src/identity.db.test.ts` (echte Datenbank, Rolle `shop_auth`), `password.test.ts`, `hashed-session-adapter.test.ts`.

**Ereignisse (geplant):** identity.user.registered.v1, identity.login.failed.v1, identity.membership.changed.v1

## Stand E6 Teil 2 (06.11.2026)

- Endpunkte der Auth-API (`src/http/auth.ts`): `POST /auth/v1/sign-in`, `POST /auth/v1/sign-out`, `GET /auth/v1/session`.
- Eigene Anmelde-Bremse (`src/internal/login-throttle.ts`): je Konto und je Netz, Sperre des Kontos in `identity.user.locked_until`.
- Der gebaute Code bringt die Liste bekannter Passwörter mit (`scripts/copy-data.mjs`).
