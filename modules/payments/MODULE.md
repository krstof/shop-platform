# Modul `payments`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit MVP-Etappe M6 (Paket `@shop/payments`), Fassade in `src/index.ts`.

**Aufgabe:** Anbieterneutrale Zahlungsabwicklung über Adapter, zuerst der eigene Test-Zahlungsanbieter, Prüfung signierter Rückmeldungen.

**Welle:** 1

**Datenbankschema:** `payments`, Tabellen: `payment_method_config`, `payment`, `payment_attempt`, `refund`, `provider_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** createPaymentSession(order), handleProviderWebhook(provider, request), refund(...)

**Ereignisse (geplant):** payments.payment.authorized.v1, payments.payment.captured.v1, payments.payment.failed.v1, payments.refund.completed.v1
