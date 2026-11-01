# Modul `tax`

> Landkarte für spätere Läufe (Architektur 8.4). Fassade und Ereignisse sind geplant, Code entsteht ab Etappe E4.

**Aufgabe:** Steuerklassen, gesetzliche Steuersätze (globale Referenzdaten), Steuer-Einstellungen je Shop, Steuerberechnung.

**Welle:** 1

**Datenbankschema:** `tax`, Tabellen: `tax_class`, `tax_rate`, `tenant_tax_setting`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (geplant):** calculate(lines, context), getRate(class, country, date)

**Ereignisse (geplant):** tax.setting.changed.v1
