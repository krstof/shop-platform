# Modul `shipping`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Versandarten, Versandkosten (pauschal), Sendungen. Bekommt Land und Zone vom Aufrufer, damit es nicht von shop-settings abhängt.

**Welle:** 1

**Datenbankschema:** `shipping`, Tabellen: `shipping_method`, `shipping_method_translation`, `shipping_rate`, `shipment`, `shipment_line`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** quote(lines, destination), createShipment(...)

**Ereignisse (geplant):** shipping.shipment.created.v1
