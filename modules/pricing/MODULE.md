# Modul `pricing`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Preise je Variante, Währung, Kanal und Kundengruppe, Preisverlauf für den 30-Tage-Tiefstpreis.

**Welle:** 1

**Datenbankschema:** `pricing`, Tabellen: `price`, `price_history`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** resolvePrices(variantIds, context), lowestPriceLast30Days(variantId)

**Ereignisse (geplant):** pricing.price.changed.v1
