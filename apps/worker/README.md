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
| `SHOP_WORKER_HEALTH_PORT` | Port des Lebenszeichens, nur auf 127.0.0.1 im Container (Standard 3001) |

## Betrieb (E5 Teil 2)

- **Abbild** `worker` aus `infra/docker/Dockerfile` (wie `api`: ohne npm, ohne Quellcode, Dateien nur lesbar, läuft als `node`).
- **Docker Compose:** startet erst, wenn `migrate` fertig ist; nur internes Netz ohne Internet, keine Ports. Die beiden Verbindungen baut Compose aus `SHOP_DB_PASSWORD_APP` und `SHOP_DB_PASSWORD_RELAY` in der `.env`.
- **Lebenszeichen** `GET /livez` (nur `127.0.0.1` im Container): `200`, solange der Worker läuft und das Relay in der letzten Minute einen fehlerfreien Durchgang hatte (nach dem Start eine Minute Anlaufzeit), sonst `503`. Der Gesundheitscheck von Docker fragt es alle 10 Sekunden ab; nach sechs Fehlschlägen gilt der Container als `unhealthy`. Ist die Datenbank weg, dauert das rund zwei Minuten; danach baut der Worker die Verbindungen von selbst neu auf.
- **Anhalten:** Auf `SIGTERM` hält er erst das Relay an, lässt laufende Aufgaben fertig werden und beendet sich mit Code 0.
- **Rauchtest** (`pnpm test:infra`): Gesundheit, Härtung, Rollen und Ende zu Ende ein Hersteller, der im Änderungsprotokoll ankommt.
