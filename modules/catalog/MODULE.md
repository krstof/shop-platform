# Modul `catalog`

> Landkarte für spätere Läufe (Architektur 8.4). Erstes Modul mit Code (E4 Teil 1): Paket `@shop/catalog`, Beispiel-Endpunkte für Hersteller. Der Rest folgt mit E10.

**Aufgabe:** Produkte mit Standard-Variante, Merkmale, Produkttypen, Kategorien, Hersteller mit GPSR-Angaben, Lieferzeit, Grundpreis-Angaben.

**Welle:** 1

**Datenbankschema:** `catalog`, Tabellen: `manufacturer`, `product_type`, `attribute`, `attribute_translation`, `attribute_value`, `attribute_value_translation`, `product_type_attribute`, `product`, `product_translation`, `product_attribute_value`, `variant`, `variant_translation`, `variant_attribute_value`, `category`, `category_translation`, `product_category`, `product_media`, `product_channel_listing`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `media`. Alles andere nur über Ereignisse.

**Fassade (geplant):** getVariantsForCart(ids), getPublishedProduct(slug), listProducts(filter)

**Ereignisse (umgesetzt, `src/catalog.events.ts`):** `catalog.manufacturer.created.v1` (`id`, `name`), `catalog.manufacturer.updated.v1` (`id`, `changes` mit nur den geänderten Spalten als `[alt, neu]`; kein Ereignis, wenn sich nichts ändert).

**Ereignisse (umgesetzt seit M2):** `catalog.product.created.v1` / `.updated.v1`, `catalog.category.created.v1` / `.updated.v1` (`changes` mit API-Feldnamen, Werte als Text).

**Ereignisse (geplant):** catalog.product.archived.v1

**Stand Code (03.11.2026):**

- `src/index.ts` (einzige öffentliche Datei): `catalogEndpoints({ database })`, Typ `Manufacturer`, Ereignisse `manufacturerCreated`, `manufacturerUpdated`, `catalogEvents`.
- Seit E5 (05.11.2026) schreiben Anlegen und Ändern ihr Ereignis in derselben Transaktion in die Outbox.
- `src/http/admin/manufacturers.ts`: `GET /admin/v1/manufacturers` (`listManufacturers`, Cursor-Liste ohne archivierte) und `GET /admin/v1/manufacturers/{manufacturerId}` (`getManufacturer`) mit `products:read`; `POST /admin/v1/manufacturers` (`createManufacturer`, Idempotency-Key möglich) und `PATCH /admin/v1/manufacturers/{manufacturerId}` (`updateManufacturer`, If-Match Pflicht) mit `products:write`.
- `src/internal/manufacturer-repository.ts`: Abfragen mit Kysely, nur in `withTenantTransaction`.

**Stand M2 (10.11.2026):** Produkte und Kategorien in der Admin-API (`/products`, `/categories`: auflisten, lesen, anlegen, ändern mit If-Match). Ein Produkt hat Standardvariante, deutschen Text (Sprache „de“), Steuerklasse `standard`/`reduced`, höchstens eine Hauptkategorie, optional Artikelnummer. Preis und Bestand liefern die Module pricing und inventory über die Schnittstellen in `src/ports.ts`, zusammengesteckt in `apps/api/src/endpoints.ts` (catalog kennt die Module nicht); sie schreiben in derselben Transaktion mit. Doppelte Adresse oder Artikelnummer: 409 (`internal/conflicts.ts`).

**Stand M2 Teil 2 (10.11.2026):** Produktbilder (`src/http/admin/product-images.ts`): `POST /products/{productId}/images` (`addProductImage`, Bild als Base64 im JSON, bis 8 MB, eigene Anfragegrenze 12 MB über `bodyLimit`), `DELETE /products/{productId}/images/{imageId}` und `PUT /products/{productId}/images` (Reihenfolge). Jede Antwort ist das ganze Produkt; jedes Produkt hat jetzt `images` (erstes = Hauptbild). Zuordnung und Reihenfolge in `catalog.product_media` (`internal/product-image-repository.ts`), höchstens 20 Bilder. Prüfen, Umrechnen und Speichern übernimmt `media` über die Schnittstelle `ProductImages` in `src/ports.ts`. Bildänderungen erhöhen die Version des Produkts und erscheinen im Ereignis `catalog.product.updated.v1` als Feld `images` (IDs mit Komma).
