# Modul `invoicing`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Rechnungen, Gutschriften und Stornos als unveränderliche Belege (Tabellen ab Welle 1, Funktion ab Welle 2).

**Welle:** 2 (Tabellen schon in Welle 1)

**Datenbankschema:** `invoicing`, Tabellen: `invoice`, `invoice_line`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `orders`, `shop-settings`. Alles andere nur über Ereignisse.

**Fassade (geplant):** issueInvoice(orderId)

**Ereignisse (geplant):** invoicing.invoice.issued.v1
