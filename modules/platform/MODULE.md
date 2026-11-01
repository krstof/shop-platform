# Modul `platform`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Händlerkonten, Shops (Mandanten), Tarife und Funktionsschalter, Domains, Plattform-Einstellungen. Nur für den Betreiber; das Schema hat keine RLS (db/global-tables.yaml).

**Welle:** 1

**Datenbankschema:** `platform`, Tabellen: `plan`, `plan_feature`, `merchant`, `tenant`, `tenant_domain`, `tenant_feature_override`, `platform_setting`, `platform_user`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `identity`. Alles andere nur über Ereignisse.

**Fassade (geplant):** resolveTenantByHost(host), getTenant(id), isFeatureEnabled(tenantId, feature), createTenant(...)

**Ereignisse (geplant):** platform.tenant.created.v1, platform.tenant.suspended.v1, platform.tenant.deleted.v1
