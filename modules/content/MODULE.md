# Modul `content`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Inhaltsseiten und Rechtstexte mit Versionen, Menüs, Weiterleitungen, Pflichtseiten-Prüfung. Das Impressum braucht die Firmendaten: content holt sie nicht selbst (sonst Kreis mit shop-settings), sondern bekommt sie über das Ereignis shop_settings.profile.updated.v1 oder vom Aufrufer.

**Welle:** 1

**Datenbankschema:** `content`, Tabellen: `page`, `page_translation`, `page_version`, `legal_document`, `legal_document_version`, `navigation_menu`, `url_redirect`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** getPublishedPage(slug), getCurrentLegalVersions(), assertLegalPagesComplete()

**Ereignisse (geplant):** content.page.published.v1, content.legal_document.published.v1

**Hört auf:** shop_settings.profile.updated.v1
