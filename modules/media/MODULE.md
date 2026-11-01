# Modul `media`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Hochladen, Prüfen, Umrechnen und Ausliefern von Bildern über signierte Adressen, kein SVG.

**Welle:** 1

**Datenbankschema:** `media`, Tabellen: `media_asset`, `media_asset_translation`, `media_rendition`, `media_usage`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** createUploadUrl(...), confirmUpload(...), getRenditions(assetId)

**Ereignisse (geplant):** media.asset.processed.v1
