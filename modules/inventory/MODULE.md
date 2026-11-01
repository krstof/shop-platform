# Modul `inventory`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Bestand je Variante und Lager, Reservierung bei Bestellung, Abbuchung, Freigabe, Bewegungsprotokoll, kein Überverkauf.

**Welle:** 1

**Datenbankschema:** `inventory`, Tabellen: `stock_location`, `stock_level`, `reservation`, `stock_movement`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** reserve(lines, ref), commit(ref), release(ref), getAvailability(variantIds)

**Ereignisse (geplant):** inventory.stock.low.v1, inventory.stock.depleted.v1

**Hört auf:** orders.order.paid.v1, orders.order.cancelled.v1
