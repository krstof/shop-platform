# ADR-006: Geldbeträge als ganze Zahlen in Cent mit Währungscode

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 4.8 und 6.2.

## Kontext

Kommazahlen (Gleitkommazahlen) können viele Dezimalwerte nicht exakt darstellen. 0,1 plus 0,2 ergibt dort zum Beispiel nicht genau 0,3. In Preisen, Steuern und Rechnungen sind solche Rundungsfehler nicht akzeptabel. Außerdem soll die Plattform später mehrere Währungen beherrschen.

## Entscheidung

- Jeder Geldbetrag ist eine ganze Zahl in der kleinsten Einheit der Währung (bei Euro in Cent) und trägt immer einen Währungscode nach ISO 4217. In der Datenbank heißt das `*_amount bigint` plus `currency char(3)`, in der API `{ "amount": 1999, "currency": "EUR" }`.
- Der `kernel` stellt einen Geld-Typ bereit, der nur Beträge gleicher Währung addiert und Rundungen ausdrücklich verlangt.
- Steuersätze werden als Basispunkte gespeichert (1900 für 19 Prozent).
- Steuern werden pro Position berechnet und kaufmännisch gerundet. Satz und Betrag werden in die Bestellung kopiert. Die Rundungsregel und die Anzahl der Nachkommastellen stehen pro Währung in Daten, nicht im Code.

## Alternativen

- Dezimaltyp `numeric` in der Datenbank mit einer Dezimal-Bibliothek im Code: exakt, aber langsamer und fehleranfälliger an der Grenze zu JavaScript, das keinen eingebauten Dezimaltyp hat.
- Gleitkommazahlen: ausgeschlossen wegen Rundungsfehlern.

## Folgen

- Summen stimmen immer auf den Cent, und Tests können exakte Werte prüfen.
- Anzeigen wandeln Beträge erst beim Darstellen in „19,99 €“ um.
- Grundpreise und Preise pro Einheit, die Bruchteile von Cent haben können, werden mit einer festgelegten Rundung nur für die Anzeige berechnet.

## Nachtrag 30.10.2026: Umsetzung im Kernel (Etappe E2)

- Im Code ist ein Betrag eine JavaScript-Zahl, die eine **sichere ganze Zahl** sein muss (höchstens 2^53 − 1, also gut 90 Billionen Euro). Damit passt sie ohne Umweg in JSON und in die API-Form `{ amount, currency }`. Jede Rechnung läuft intern mit `bigint`, und ein Ergebnis außerhalb des sicheren Bereichs wirft einen Fehler, statt still zu runden.
- Alternative `bigint` überall (Bewertung 3): exakt bis in beliebige Größen, aber JSON kann `bigint` nicht direkt, und jede Oberfläche bräuchte eine Sonderbehandlung. Für einen Shop ist der sichere Bereich mehr als genug.
- Rundung: `half_up` ist kaufmännisch (ab der Hälfte weg von null, auch bei negativen Beträgen), `half_even` rundet bei genau der Hälfte zur geraden Zahl. Die Regel kommt aus `kernel.currency.rounding_mode`.
- Verteilen eines Betrags (zum Beispiel Versandkosten auf Steuersätze) nach dem Verfahren der größten Reste: Die Teile ergeben immer genau die Summe.
