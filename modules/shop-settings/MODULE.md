# Modul `shop-settings`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit MVP-Etappe M6 (Paket `@shop/shop-settings`), Fassade in `src/index.ts`.

**Aufgabe:** Firmendaten und Pflichtangaben, Verkaufskanäle, Länder und Zonen, Nummernkreise, Cookie-Einstellungen, Shop online/offline mit Prüfliste.

**Welle:** 1

**Datenbankschema:** `shop_settings`, Tabellen: `shop_profile`, `sales_channel`, `sales_country`, `zone`, `zone_country`, `number_range`, `cookie_service`, `cookie_consent_config`, `cookie_consent_log`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `content`, `payments`, `shipping`. Alles andere nur über Ereignisse.

**Fassade (geplant):** getShopProfile(), getDefaultChannel(), nextNumber(type), goOnline()

**Ereignisse (geplant):** shop_settings.profile.updated.v1, shop_settings.shop.went_online.v1
