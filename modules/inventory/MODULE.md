# Modul `inventory`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit MVP-Etappe M2 (Paket `@shop/inventory`).

**Aufgabe:** Bestand je Variante und Lager, Reservierung bei Bestellung, Abbuchung, Freigabe, Bewegungsprotokoll, kein Überverkauf.

**Welle:** 1

**Datenbankschema:** `inventory`, Tabellen: `stock_location`, `stock_level`, `reservation`, `stock_movement`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (umgesetzt seit M2):** `createInventory({ database })` mit `setOnHand` (Bestand im Standardlager setzen; das Lager „standard“ entsteht beim ersten Mal, jede Änderung schreibt eine Lagerbewegung `initial`/`adjustment`) und `getAvailable` (vorhanden minus reserviert über alle Lager). Läuft innerhalb einer Transaktion des Aufrufers mit.

**Ereignisse (geplant):** inventory.stock.low.v1, inventory.stock.depleted.v1

**Hört auf:** orders.order.paid.v1, orders.order.cancelled.v1
