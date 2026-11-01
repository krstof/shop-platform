# Modul `storefront`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Themes, Vorlagen und Seitenaufbau aus Abschnitten und Bausteinen, Entwurf und Veröffentlichung, Grundlage für den Shop-Editor.

**Welle:** 1 (Grundgerüst), Editor ab 2

**Datenbankschema:** `storefront`, Tabellen: `theme`, `theme_installation`, `template`, `template_version`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `catalog`, `content`, `media`, `pricing`, `shop-settings`, `tax`. Alles andere nur über Ereignisse.

**Fassade (geplant):** getPublishedTemplate(kind), saveDraft(...), publish(...)

**Ereignisse (geplant):** storefront.template.published.v1
