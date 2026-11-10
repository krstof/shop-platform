# Modul `media`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit MVP-Etappe M2 Teil 2 (Paket `@shop/media`).

**Aufgabe:** Hochladen, Prüfen, Umrechnen und Ausliefern von Bildern über signierte Adressen, kein SVG.

**Welle:** 1

**Datenbankschema:** `media`, Tabellen: `media_asset`, `media_asset_translation`, `media_rendition`, `media_usage`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (umgesetzt seit M2 Teil 2):** `createMedia({ database, storage, publicBaseUrl })` mit `prepareImage` (prüft und rechnet ohne Datenbank), `saveImage` (lädt hoch, trägt `media_asset` und `media_rendition` ein, läuft in der Transaktion des Aufrufers mit), `getImages(ids)` und `deleteImages(ids)` (Zeilen und Dateien; nach der Transaktion des Aufrufers rufen). Speicher: `createS3Storage(...)` (AWS-SDK, Garage, Pfad-Stil) oder `memoryStorage()` für Tests und OpenAPI.

**Regeln:** Nur JPEG, PNG und WebP, erkannt an den ersten Bytes und noch einmal von sharp; kein SVG, GIF, HEIC. Höchstens 8 MB und 40 Megapixel, mindestens 32 × 32 Pixel. Ausgeliefert werden nur neu berechnete WebP-Fassungen `w1600` und `w400` (aufgerichtet, ohne EXIF/GPS) im Bereich `public` unter `tenants/<shop>/media/<bild>/<preset>.webp` mit `Cache-Control: immutable`; das Original liegt nur im Bereich `private`. Status ist sofort `ready` (keine Verarbeitung im Hintergrund).

**Fassade (geplant):** createUploadUrl(...), confirmUpload(...) für direkte Uploads in den Speicher, Alternativtext je Sprache

**Ereignisse (geplant):** media.asset.processed.v1
