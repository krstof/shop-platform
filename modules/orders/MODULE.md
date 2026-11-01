# Modul `orders`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Bestellungen als unveränderliche Momentaufnahme, Status für Bestellung, Zahlung und Versand, Zeitleiste, Widerruf.

**Welle:** 1

**Datenbankschema:** `orders`, Tabellen: `order`, `order_line`, `order_address`, `order_tax_line`, `order_legal_acceptance`, `order_event`, `withdrawal`, `withdrawal_line`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `shop-settings`. Alles andere nur über Ereignisse.

**Fassade (geplant):** createFromCheckout(snapshot), getOrder(id), changeStatus(...), requestWithdrawal(...)

**Ereignisse (geplant):** orders.order.placed.v1, orders.order.paid.v1, orders.order.shipped.v1, orders.order.cancelled.v1, orders.withdrawal.requested.v1

**Hört auf:** payments.payment.captured.v1, payments.payment.failed.v1
