# Modul `customers`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Kunden und Gastkunden, Adressen, Kundengruppen (Standard „Endkunden“), vorbereitete Firmenkonten, Einwilligungen.

**Welle:** 1 (Kundenkonto ab 2, Firmen ab 3)

**Datenbankschema:** `customers`, Tabellen: `customer_group`, `company`, `customer`, `customer_group_member`, `company_member`, `customer_address`, `consent_event`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** findOrCreateGuest(email), getCustomerGroups(customerId)

**Ereignisse (geplant):** customers.customer.created.v1, customers.customer.erased.v1

**Hört auf:** orders.order.placed.v1
