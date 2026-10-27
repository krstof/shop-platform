# ADR-002: Modularer Monolith mit automatisch geprüften Grenzen

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 3.

## Kontext

Kristof hat entschieden, dass die Plattform als modularer Monolith gebaut wird und später in Dienste aufteilbar sein soll (siehe `FRAGEN.md`). Ein Monolith ist ein einziges Programm. Ohne strenge innere Ordnung wächst so ein Programm zu einem Knäuel zusammen, in dem jede Änderung überall etwas kaputt machen kann. Das ist bei KI-geschriebenem Code besonders gefährlich.

## Entscheidung

- Der Kern besteht aus Fachmodulen wie `catalog`, `pricing`, `orders` und `payments`. Jedes Modul besitzt ein eigenes Datenbankschema und nur dessen Tabellen.
- Andere Module erreichen ein Modul nur über seine Fassade in `index.ts` oder über Ereignisse. Verweise über Modulgrenzen bestehen nur aus IDs, ohne Fremdschlüssel und ohne gemeinsame Abfragen.
- Jedes Modul erklärt seine erlaubten Abhängigkeiten in `module.json`. Kreise sind verboten.
- Durchgesetzt wird das automatisch durch dependency-cruiser, durch Datenbanktypen, die pro Modul nur das eigene Schema enthalten, durch eine ESLint-Regel gegen rohes SQL und durch die Exportregeln von NestJS.
- Mehrstufige Vorgänge sind benannte Workflows mit Kompensationsschritten.

## Alternativen

- Microservices ab Tag 1: viel Betriebsaufwand, verteilte Fehler und Netzwerkprobleme ohne Nutzen bei wenigen Shops.
- Klassischer Monolith ohne Grenzen: am Anfang am schnellsten, später kaum noch aufteilbar.

## Folgen

- Ein Verstoß gegen die Grenzen bricht den Build ab und kann nicht unbemerkt auf `main` landen.
- Daten aus mehreren Modulen zusammenzusetzen braucht mehr Code als ein einfacher Join. Das ist der bewusste Preis für die spätere Aufteilbarkeit.
- Ein Modul wird zum Dienst, indem seine Tabellen in eine eigene Datenbank ziehen, die Fassade per HTTP aufgerufen wird und gemeinsame Transaktionen zu Sagas werden.
