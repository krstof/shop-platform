# Modul `audit`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit Etappe E5 (05.11.2026): Paket `@shop/audit`.

**Aufgabe:** Unveränderliches Änderungsprotokoll: wer hat was wann getan (Mensch, Token, System).

**Welle:** 1

**Datenbankschema:** `audit`, Tabellen: `audit_entry`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (umgesetzt):** `auditEndpoints({ database })` für die API, `auditSubscribers()` für den Worker. Eine Funktion `record(entry)` für direkte Einträge kommt erst, wenn ein Modul sie braucht (bisher entsteht jeder Eintrag aus einem Ereignis).

**Endpunkt:** `GET /admin/v1/audit-entries` (`listAuditEntries`, Berechtigung `audit:read`): neueste zuerst, Cursor, Filter `entityType`, `entityId`, `actorType`, `actorId`. Die Sicht des Betreibers über alle Shops folgt mit E20.

**Ereignisse (geplant):** keine

**Hört auf:** alle Ereignisse (Subscriber `audit.record`, `src/record.subscriber.ts`). Übernimmt nur Hülle, `data.id` und `data.changes`, keine weiteren Daten. Genau einmal über die Inbox `processed_event`.

**Entscheidungen Kristof (05.11.2026):** Das Protokoll enthält alles, auch Aktionen der Kunden im Shop. Einträge werden nie automatisch gelöscht.
