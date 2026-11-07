# Modul `platform`

> Landkarte für spätere Läufe (Architektur 8.4). Stand: E6 Teil 3 (07.11.2026), erste Fassade.

**Aufgabe:** Händlerkonten, Shops (Mandanten), Tarife und Funktionsschalter, Domains, Plattform-Einstellungen. Nur für den Betreiber; das Schema hat keine RLS (db/global-tables.yaml).

**Welle:** 1

**Datenbankschema:** `platform`, Tabellen: `plan`, `plan_feature`, `merchant`, `tenant`, `tenant_domain`, `tenant_feature_override`, `platform_setting`, `platform_user`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `identity`. Alles andere nur über Ereignisse.

**Fassade (heute):** `createShopDirectory({ database })` mit `getShops(ids)`: Kennung, Handle, Name und Zustand von Shops, gelesen als shop_app (nur lesen) aus `platform.tenant`. Nutzt `apps/api` für die Shop-Auswahl (nur Shops im Zustand `active` gelten).

**Seit E6 Teil 4:** `createOperatorDirectory({ database })` mit `findOperator(userId)`: aktives Betreiberkonto und Rolle aus `platform.platform_user` (shop_app darf dort nur `user_id`, `role`, `status` lesen, Migration `20261107T090100`). Erster Endpunkt der Platform-API in `src/http/platform.ts`: `GET /platform/v1/operator` (Berechtigung `platform:read`, die `apps/api` nur mit bestätigtem zweitem Faktor vergibt).

**Fassade (geplant):** resolveTenantByHost(host), isFeatureEnabled(tenantId, feature), createTenant(...)

**Ereignisse (geplant):** platform.tenant.created.v1, platform.tenant.suspended.v1, platform.tenant.deleted.v1
