# ADR-009: Endpunkte als Verträge statt als NestJS-Controller

Status: angenommen. Datum: 03.11.2026. Umsetzung: `packages/http`, `apps/api` (Etappe E4, Teil 1).

## Kontext

ADR-001 legt NestJS mit Fastify fest, ADR-004 REST mit OpenAPI aus Zod-Schemas. Der übliche Weg in NestJS sind Controller-Klassen mit Dekoratoren (`@Get()`, `@UseGuards()`, `@ApiProperty()`). Dabei muss jeder Endpunkt seine Berechtigung, seine Prüfung und seine OpenAPI-Angaben einzeln an der richtigen Stelle anbringen. Vergisst ein Endpunkt einen Dekorator, fällt das erst in einem Test oder gar nicht auf. Außerdem braucht die Dekorator-Technik eine besondere Übersetzung des Codes (`emitDecoratorMetadata`), die die Testwerkzeuge nicht vollständig unterstützen.

## Entscheidung

- Jeder Endpunkt ist ein **Vertrag**, beschrieben mit `defineEndpoint` aus `@shop/http`: API, Methode, Pfad, `operationId`, Beschreibung, Berechtigung, Zod-Schemas für Pfad, Abfrage, Inhalt und Antwort, dazu die Funktion, die die Anfrage bearbeitet.
- Schon beim Laden wird geprüft: Admin- und Platform-API verlangen immer eine Berechtigung aus einer festen Liste, öffentliche Endpunkte gibt es nur in der Storefront-API und nur mit Begründung; alle Eingabeschemas sind auf jeder Ebene streng; Platzhalter im Pfad und Pfad-Schema passen genau zusammen. Ein Verstoß verhindert den Start.
- `apps/api` registriert alle Verträge mit einer einzigen Routine (`router.ts`) bei Fastify. Jede Anfrage läuft dieselbe Kette: Anmeldung und Berechtigung (vor der Eingabeprüfung), strenge Eingabeprüfung, Ausführung im Anfrage-Kontext mit Mandant, Ausgabe nur durch das Antwort-Schema, Fehler als Problem Details.
- Die OpenAPI-Dateien entstehen aus denselben Verträgen (`openapi/admin.json`, `store.json`, `platform.json`, eingecheckt, in der CI auf Aktualität geprüft).
- NestJS bleibt der Rahmen des Programms (Start, Abhängigkeiten, Lebenszyklus, später Fassaden der Module als Anbieter), aber ohne Dekoratoren: Module werden als dynamische Module beschrieben.
- Module liefern ihre Endpunkte über ihre öffentliche Datei `src/index.ts` (zum Beispiel `catalogEndpoints({ database })`).

## Alternativen

- NestJS-Controller mit Dekoratoren und einem Zusatzpaket für Zod (zum Beispiel `nestjs-zod`): verbreitet, aber Berechtigung und Prüfung lassen sich je Endpunkt vergessen, und die Dekorator-Übersetzung verträgt sich schlecht mit Vitest.
- Fremde Vertragsbibliothek (zum Beispiel ts-rest oder zod-openapi): weniger eigener Code, aber eine weitere Abhängigkeit in der Lieferkette, und die Regeln „Standard verboten“ und „streng auf allen Ebenen“ müssten trotzdem selbst gebaut werden.
- Reines Fastify ohne NestJS: noch schlanker, weicht aber von ADR-001 ab; NestJS wird für die Zusammensetzung der Module ab E5 gebraucht.

## Folgen

- Es gibt genau einen Weg, einen Endpunkt anzulegen. Der globale Wächter (Q-03) lässt sich nicht umgehen, weil kein Endpunkt außerhalb des Routers existiert.
- Die OpenAPI-Erzeugung ist eigener Code (rund 200 Zeilen) auf Basis von `z.toJSONSchema` aus Zod 4; benannte Schemas (`.meta({ id })`) werden zu `components/schemas`.
- Die Generatoren für T-08 und T-09 (E4 Teil 2) lesen die OpenAPI-Dateien und erzeugen daraus Tests für jeden Endpunkt.
- Wer NestJS-Beispiele aus dem Netz kennt, findet hier keine Controller; die Arbeitsweise steht in `packages/http/README.md`.
