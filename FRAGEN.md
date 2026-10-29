# FRAGEN an Kristof

Offene Fragen stehen oben. Kristof antwortet im Chat, Claude trägt die Antwort hier ein und verschiebt die Frage nach unten.

## Offen

Gestellt am 29.10.2026 zum Anforderungskatalog Welle 1 (`docs/06_Welle1_Anforderungen.md`). Bis zur Antwort gilt die Empfehlung.

1. **Rechtstext-Vorlagen?** Ein neuer Shop kann leere Rechtstexte bekommen oder Vorlagen mit Platzhaltern, die die Plattform aus den Firmendaten füllt. Vorlagen sind bequemer, aber keine geprüften Rechtstexte. Antwort: **Vorlagen** (Empfehlung) / **leer**
2. **Wann verfällt eine unbezahlte Bestellung?** Bricht ein Kunde die Zahlung ab, bleibt die Bestellung offen und die Ware reserviert. Nach dieser Frist wird sie automatisch storniert. Antwort: **1** / **24** (Empfehlung) / **72** (Stunden)
3. **Ware schon im Warenkorb reservieren?** Reservieren beim Hineinlegen blockiert Ware durch verlassene Warenkörbe. Reservieren erst beim Bestellen kann bedeuten, dass ein Produkt kurz vorher ausverkauft ist, dann sieht der Kunde einen Hinweis. Antwort: **Bestellung** (Empfehlung) / **Warenkorb**
4. **Kleinunternehmerregelung schon in Welle 1?** Kleinunternehmer weisen keine Umsatzsteuer aus. Das Datenmodell kann es schon, die Funktion kostet etwa einen halben Lauf mehr. Antwort: **später** (Empfehlung) / **jetzt**
5. **Stil des Standard-Designs der Storefront?** Das Design ist in Welle 1 fest, der Händler wählt nur Logo, Farbe und Schrift. Antwort: **schlicht** (Empfehlung) / **verspielt** / **edel**
6. **Was verkaufen die zwei Testshops?** Beispieldaten machen Tests und Vorführungen anschaulicher. Geplant sind ein Teeladen und ein Modeladen. Antwort: **passt** / oder zwei andere Branchen nennen

## Beantwortet

- **Better Auth behalten?** Ja, behalten, mit den nötigsten Funktionen, fester Version und wöchentlicher Prüfung. (28.10.2026)
- **Rechnungen 8 oder 10 Jahre aufbewahren?** 10 Jahre, wie im ursprünglichen Auftrag (mehr als gesetzlich nötig). (28.10.2026)
- **Betreiberkonto in Welle 1 mit Zwei-Faktor?** Ja, schon in Welle 1. (28.10.2026)
- **Öffentlicher Testserver?** Nein, nur lokal und in Tests. (27.10.2026)
- **Repository privat?** Ja, bleibt privat. (27.10.2026)
- **KI-Modell Welle 2?** Beides: zuerst Bezahl-API (z. B. Claude), freies lokales Modell als Option offenhalten. (27.10.2026)
- **Stripe-Testmodus in Welle 1?** Nein, nur der eigene Test-Zahlungsanbieter; Stripe frühestens Welle 2. (27.10.2026)
- **Welle 1 schlank oder komplett?** Komplett, mit allen deutschen Rechtspflichten aus dem Featurekatalog (63 Muss-Funktionen). (27.10.2026)
- **Kopie auf dem Mac?** Ja, in /Volumes/Files/Claude/ePages/Shop_System_MVP. Die Cloud-Läufe erreichen den Mac nicht; die Kopie wird in Chat-Sitzungen mit verbundenem Mac aktualisiert. (27.10.2026)

- **Wofür ist das System?** Reines privates Experiment, keine echten Händler, keine echten Kunden, kein echtes Geld. (27.10.2026)
- **Architektur?** Modularer Monolith, API-first, später in Dienste aufteilbar. (27.10.2026)
- **Ablage?** Privates GitHub-Repository krstof/shop-platform plus Kopie auf dem Mac. (27.10.2026)
- **Rhythmus?** Täglich ein automatischer Lauf mit Fragenkatalog. (27.10.2026)
- **Kosten?** In Ordnung, solange Kristof sie unter Kontrolle hat. (27.10.2026)
- **Shop-Editor?** Gemeint ist ein Editor im Händler-Backend, mit dem der Händler das Aussehen seines Shops gestaltet. Details werden später besprochen. (27.10.2026)
