# Modul `shipping`

> Landkarte für spätere Läufe (Architektur 8.4). Seit 14.11.2026 mit Code: Standardversand mit Pauschale.

**Aufgabe:** Versandarten, Versandkosten (pauschal), Sendungen. Bekommt Land und Zone vom Aufrufer, damit es nicht von shop-settings abhängt.

**Welle:** 1

**Datenbankschema:** `shipping`, Tabellen: `shipping_method`, `shipping_method_translation`, `shipping_rate`, `shipment`, `shipment_line`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Heute:** Eine Versandart `standard` (Pauschale in `shipping_rate`, Grenze für kostenlosen Versand in `shipping_method.free_shipping_threshold_amount`, nur EUR, alle Länder). Ohne Eintrag: kostenlos. Fassade `createShipping().quote(subtotal)`; Regeln in `internal/rules.ts`. API: `GET/PUT /admin/v1/shipping` (`settings:read`/`settings:write`), `GET /store/v1/shops/{h}/shipping`. Checkout ruft `quote` über eine eigene Schnittstelle auf (zusammengesteckt in apps/api); die MwSt. auf den Versand rechnet orders (`shippingRateBp`: Satz mit dem größten Warenwert).

**Fassade (geplant, später):** quote(lines, destination) mit Gewicht und Zonen, createShipment(...)

**Ereignisse (geplant):** shipping.shipment.created.v1
