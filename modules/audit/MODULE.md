# Modul `audit`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Unveränderliches Änderungsprotokoll: wer hat was wann getan (Mensch, Token, System).

**Welle:** 1

**Datenbankschema:** `audit`, Tabellen: `audit_entry`, `processed_event`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** record(entry), list(filter)

**Ereignisse (geplant):** keine

**Hört auf:** alle Ereignisse
