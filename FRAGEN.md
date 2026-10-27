# FRAGEN an Kristof

Offene Fragen stehen oben. Kristof antwortet im Chat, Claude trägt die Antwort hier ein und verschiebt die Frage nach unten.

## Offen

1. **Öffentlicher Testserver?** Bisher läuft die Plattform nur in Claudes Cloud-Umgebung und in automatischen Tests, niemand kann sie von außen im Browser ansehen. Ein kleiner gemieteter Server kostet etwa 5 bis 10 Euro im Monat. Antwort: **nein** / **später** (ab Ende Welle 1) / **ja**
2. **Repository privat lassen?** Private Repositories haben auf GitHub begrenzte kostenlose Rechenzeit für automatische Prüfungen, langsame Browser-Tests laufen dann nur nachts. Öffentlich gäbe es unbegrenzte Rechenzeit und kostenlose Sicherheitsanalysen, aber jeder könnte den Code lesen. Antwort: **privat** / **öffentlich**
3. **KI-Modell für den Händler-Assistenten (Welle 2)?** Ein freies Modell auf eigenem Server braucht einen Rechner mit starker Grafikkarte, ein Bezahlmodell wie Claude kostet pro Nutzung, braucht aber keine Hardware. Antwort: **lokal** / **API** / **beides** (API zuerst, lokal als Option)
4. **Stripe-Testmodus schon in Welle 1?** Geplant ist ein selbst gebauter Test-Zahlungsanbieter. Stripe im Testmodus würde zeigen, dass die Zahlungsschnittstelle mit einem echten Anbieter funktioniert, braucht aber ein kostenloses Stripe-Konto. Antwort: **nein** (erst Welle 2) / **ja**

## Beantwortet

- **Welle 1 schlank oder komplett?** Komplett, mit allen deutschen Rechtspflichten aus dem Featurekatalog (63 Muss-Funktionen). (27.10.2026)
- **Kopie auf dem Mac?** Ja, in /Volumes/Files/Claude/ePages/Shop_System_MVP. Die Cloud-Läufe erreichen den Mac nicht; die Kopie wird in Chat-Sitzungen mit verbundenem Mac aktualisiert. (27.10.2026)

- **Wofür ist das System?** Reines privates Experiment, keine echten Händler, keine echten Kunden, kein echtes Geld. (27.10.2026)
- **Architektur?** Modularer Monolith, API-first, später in Dienste aufteilbar. (27.10.2026)
- **Ablage?** Privates GitHub-Repository krstof/shop-platform plus Kopie auf dem Mac. (27.10.2026)
- **Rhythmus?** Täglich ein automatischer Lauf mit Fragenkatalog. (27.10.2026)
- **Kosten?** In Ordnung, solange Kristof sie unter Kontrolle hat. (27.10.2026)
- **Shop-Editor?** Gemeint ist ein Editor im Händler-Backend, mit dem der Händler das Aussehen seines Shops gestaltet. Details werden später besprochen. (27.10.2026)
