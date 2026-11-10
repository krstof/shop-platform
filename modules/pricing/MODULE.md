# Modul `pricing`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit MVP-Etappe M2 (Paket `@shop/pricing`).

**Aufgabe:** Preise je Variante, Währung, Kanal und Kundengruppe, Preisverlauf für den 30-Tage-Tiefstpreis.

**Welle:** 1

**Datenbankschema:** `pricing`, Tabellen: `price`, `price_history`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (umgesetzt seit M2):** `createPricing({ database })` mit `setBasePrice` (ein Grundpreis brutto je Variante und Währung, Upsert, Verlauf per Trigger) und `getBasePrices`. Läuft innerhalb einer Transaktion des Aufrufers mit.

**Fassade (geplant):** resolvePrices(variantIds, context), lowestPriceLast30Days(variantId)

**Ereignisse (geplant):** pricing.price.changed.v1
