# Modul `catalog`

> Landkarte für spätere Läufe (Architektur 8.4). Erstes Modul mit Code (E4 Teil 1): Paket `@shop/catalog`, Beispiel-Endpunkte für Hersteller. Der Rest folgt mit E10.

**Aufgabe:** Produkte mit Standard-Variante, Merkmale, Produkttypen, Kategorien, Hersteller mit GPSR-Angaben, Lieferzeit, Grundpreis-Angaben.

**Welle:** 1

**Datenbankschema:** `catalog`, Tabellen: `manufacturer`, `product_type`, `attribute`, `attribute_translation`, `attribute_value`, `attribute_value_translation`, `product_type_attribute`, `product`, `product_translation`, `product_attribute_value`, `variant`, `variant_translation`, `variant_attribute_value`, `category`, `category_translation`, `product_category`, `product_media`, `product_channel_listing`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `media`. Alles andere nur über Ereignisse.

**Fassade (geplant):** getVariantsForCart(ids), getPublishedProduct(slug), listProducts(filter)

**Ereignisse (umgesetzt, `src/catalog.events.ts`):** `catalog.manufacturer.created.v1` (`id`, `name`), `catalog.manufacturer.updated.v1` (`id`, `changes` mit nur den geänderten Spalten als `[alt, neu]`; kein Ereignis, wenn sich nichts ändert).

**Ereignisse (geplant):** catalog.product.created.v1, catalog.product.published.v1, catalog.product.updated.v1, catalog.product.archived.v1

**Stand Code (03.11.2026):**

- `src/index.ts` (einzige öffentliche Datei): `catalogEndpoints({ database })`, Typ `Manufacturer`, Ereignisse `manufacturerCreated`, `manufacturerUpdated`, `catalogEvents`.
- Seit E5 (05.11.2026) schreiben Anlegen und Ändern ihr Ereignis in derselben Transaktion in die Outbox.
- `src/http/admin/manufacturers.ts`: `GET /admin/v1/manufacturers` (`listManufacturers`, Cursor-Liste ohne archivierte) und `GET /admin/v1/manufacturers/{manufacturerId}` (`getManufacturer`) mit `products:read`; `POST /admin/v1/manufacturers` (`createManufacturer`, Idempotency-Key möglich) und `PATCH /admin/v1/manufacturers/{manufacturerId}` (`updateManufacturer`, If-Match Pflicht) mit `products:write`.
- `src/internal/manufacturer-repository.ts`: Abfragen mit Kysely, nur in `withTenantTransaction`.
