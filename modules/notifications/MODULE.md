# Modul `notifications`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** E-Mails an Kunden und Händler im Hintergrund, Meldungen im Backoffice.

**Welle:** 1

**Datenbankschema:** `notifications`, Tabellen: `email_template`, `email_message`, `inbox_notification`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): `content`, `orders`, `shop-settings`. Alles andere nur über Ereignisse.

**Fassade (geplant):** send(templateKey, data, recipient)

**Ereignisse (geplant):** notifications.email.sent.v1, notifications.email.failed.v1

**Hört auf:** orders.order.placed.v1, orders.order.paid.v1, orders.order.shipped.v1, orders.withdrawal.requested.v1
