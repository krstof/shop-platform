# Modul `storefront`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit Shop-Editor Teil 1 (13.11.2026, Paket `@shop/storefront-design`, weil `@shop/storefront` schon die Astro-App ist). Fassade in `src/index.ts`.

**Aufgabe:** Themes, Vorlagen und Seitenaufbau aus Abschnitten und Bausteinen, Entwurf und Veröffentlichung, Grundlage für den Shop-Editor.

**Welle:** 1 (Grundgerüst), Editor ab 2

**Datenbankschema:** `storefront`, Tabellen: `theme`, `theme_installation`, `template`, `template_version`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `catalog`, `content`, `media`, `pricing`, `shop-settings`, `tax`. Alles andere nur über Ereignisse.

**Heute:** Aussehen (Hauptfarbe, Schrift, Logo) in `theme_installation.settings_draft` und `settings_published` (JSON). Admin-API `/admin/v1/design` (lesen), `PUT /design/draft` (If-Match, Kontrast ≥ 4,5 : 1 zu weißer Schrift), `POST /design/logo`, `POST /design/publish`, `POST /design/discard`; Storefront-API `GET /store/v1/shops/{shopHandle}/design`. Berechtigung `settings:read`/`settings:write`. Bilder über den Port `DesignImages` (Modul media, zusammengesteckt in apps/api). Nicht mehr benutzte Logos werden samt Dateien gelöscht.

**Fassade (geplant):** getPublishedTemplate(kind), saveDraft(...), publish(...)

**Ereignisse (geplant):** storefront.template.published.v1, storefront.design.published.v1 (heute noch ohne Ereignis)
