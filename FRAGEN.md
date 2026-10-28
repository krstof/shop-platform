# FRAGEN an Kristof

Offene Fragen stehen oben. Kristof antwortet im Chat, Claude trägt die Antwort hier ein und verschiebt die Frage nach unten.

## Offen

1. **Better Auth als Anmelde-Baustein behalten?** Die Bibliothek für die Anmeldung hatte 2025 und 2026 mehrere ernste Sicherheitslücken, die jeweils schnell behoben wurden. Empfehlung: behalten, aber nur mit den nötigsten Funktionen, fester Version und wöchentlicher Prüfung; die Alternative Zitadel ist robuster, aber deutlich schwerer zu betreiben.
   Antwort: **behalten** / **wechseln**
2. **Rechnungen 8 oder 10 Jahre aufbewahren?** Seit 2025 verlangt das Gesetz für Rechnungen nur noch 8 Jahre, im ursprünglichen Auftrag standen 10. Für die Plattform ist das nur ein Einstellungswert.
   Antwort: **8** / **10**
3. **Betreiberkonto schon in Welle 1 mit Zwei-Faktor schützen?** Die Plattform-Verwaltung ist das mächtigste Konto, und der zweite Faktor (Code aus einer App) ist wenig Zusatzarbeit. Für Händler kommt er laut Plan erst in Welle 2.
   Antwort: **ja** / **später**

## Beantwortet

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
