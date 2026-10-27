# ADR-007: Ereignisse über das Outbox-Muster

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 3.5.

## Kontext

Module sollen auf Änderungen anderer Module reagieren, ohne sie direkt zu kennen, zum Beispiel E-Mail-Versand nach einer Bestellung oder Audit-Einträge nach jeder Änderung. Später hängen Webhooks, Statistik und die KI an denselben Ereignissen. Würde ein Modul erst seine Daten speichern und danach getrennt ein Ereignis verschicken, könnte bei einem Absturz dazwischen das Ereignis verloren gehen.

## Entscheidung

- Ein Modul schreibt jedes Ereignis in derselben Transaktion wie seine Datenänderung in die Tabelle `kernel.outbox`.
- Ein Relay im Worker liest neue Einträge und stellt für jeden Subscriber eine Aufgabe in pg-boss ein. Fehlgeschlagene Aufgaben werden wiederholt.
- Subscriber sind idempotent: Sie merken sich verarbeitete Ereignis-IDs in einer eigenen Inbox-Tabelle und ignorieren Wiederholungen.
- Ereignisse haben eine einheitliche Hülle (`id`, `type`, `tenantId`, `occurredAt`, `actor`, `correlationId`, `data`), einen Namen nach dem Muster `<modul>.<sache>.<vergangenheitsform>.v<n>` und ein Zod-Schema.
- Die Outbox wird nach Zeit aufgeteilt und alte Einträge werden nach einer Aufbewahrungsfrist entfernt.

## Alternativen

- Ereignisse nur im Arbeitsspeicher: einfach, aber Ereignisse gehen bei Absturz oder Neustart verloren.
- Ein externer Nachrichtenbus wie Kafka ab Tag 1: ein schwerer Zusatzdienst und trotzdem ohne Garantie, wenn nicht ebenfalls eine Outbox genutzt wird.

## Folgen

- Kein Ereignis geht verloren, aber ein Ereignis kann mehrfach ankommen. Darauf muss jeder Subscriber eingestellt sein.
- Ereignisse kommen mit kurzer Verzögerung an. Was sofort feststehen muss, läuft über einen direkten Fassadenaufruf.
- Beim Herauslösen eines Moduls oder ab sehr vielen Shops leitet das Relay Ereignisse an NATS JetStream oder Kafka statt an pg-boss weiter, ohne dass sich die Module ändern.
