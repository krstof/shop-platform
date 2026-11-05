# @shop/worker

Dienst für alles, was im Hintergrund läuft (Architektur 3.5, BET-05, Etappe E5):

1. **Relay:** liest neue Ereignisse aus `kernel.outbox` und stellt je Subscriber eine Aufgabe in die Warteschlange (pg-boss). Läuft ständig, mehrere Worker teilen sich die Arbeit.
2. **Zustellung:** holt die Aufgaben ab und ruft den Subscriber auf, genau einmal je Ereignis (Inbox `processed_event`). Bei Fehlern wiederholt pg-boss die Aufgabe bis zu zehnmal mit wachsenden Abständen.
3. **Aufräumen:** stündlich (Minute 17) abgelaufene Idempotenz-Schlüssel und veröffentlichte Ereignisse nach `SHOP_OUTBOX_RETENTION_DAYS` Tagen (Standard 30).

Neue Subscriber eines Moduls werden in `src/subscribers.ts` eingetragen.

| Einstellung | Bedeutung |
|---|---|
| `SHOP_APP_DATABASE_URL` | Verbindung als `shop_app`: Verarbeitung je Shop |
| `SHOP_RELAY_DATABASE_URL` | Verbindung als `shop_relay`: Outbox, Warteschlange, Aufräumen |
| `SHOP_OUTBOX_RETENTION_DAYS` | Aufbewahrung veröffentlichter Ereignisse in Tagen (1 bis 3650) |

Noch offen (E5 Teil 2): eigenes Container-Abbild, Eintrag in Docker Compose und `.env.example`, Lebenszeichen für den Gesundheitscheck.
