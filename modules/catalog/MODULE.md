# Modul `catalog`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Produkte mit Standard-Variante, Merkmale, Produkttypen, Kategorien, Hersteller mit GPSR-Angaben, Lieferzeit, Grundpreis-Angaben.

**Welle:** 1

**Datenbankschema:** `catalog`, Tabellen: `manufacturer`, `product_type`, `attribute`, `attribute_translation`, `attribute_value`, `attribute_value_translation`, `product_type_attribute`, `product`, `product_translation`, `product_attribute_value`, `variant`, `variant_translation`, `variant_attribute_value`, `category`, `category_translation`, `product_category`, `product_media`, `product_channel_listing`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `media`. Alles andere nur über Ereignisse.

**Fassade (geplant):** getVariantsForCart(ids), getPublishedProduct(slug), listProducts(filter)

**Ereignisse (geplant):** catalog.product.created.v1, catalog.product.published.v1, catalog.product.updated.v1, catalog.product.archived.v1
