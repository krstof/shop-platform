# FRAGEN an Kristof

Offene Fragen stehen oben. Kristof antwortet im Chat, Claude trägt die Antwort hier ein und verschiebt die Frage nach unten.

## Offen

(keine)

## Beantwortet

- **Neue Bestellungen auf der Galaxy Watch:** „Uhr-App“; danach pausiert, später nahtlos weitermachen (Stand in `apps/watch/README.md`). (Kristof, 15.11.2026)
- **Testserver ohne GitHub-Kosten:** Öffentlich ist in Ordnung („egal, wenn jeder den Code sehen kann“), nichts soll kaputtgehen. Geheimnis-Prüfung des ganzen Verlaufs vorher: nichts gefunden. (Kristof, 14.11.2026)
- **GitHub-Abrechnung:** Kein Geld für GitHub; es soll ohne Kosten gehen. (Kristof, 14.11.2026)

- **Erst testen oder weiterbauen?** Weiterbauen. (Kristof, 14.11.2026)
- **Schreibweise des Namens:** „Slopify“ (ein p). (Kristof, 14.11.2026)
- **Eigenes Logo:** Kristof wollte das geschickte Logo einbauen (nur ein Scherz, nur für zwei, drei Kollegen). Das Bild gleicht dem Logo einer echten Marke zu sehr, deshalb ist stattdessen ein eigenes Zeichen eingebaut: ein violetter Klecks, der nach unten tropft, mit dem Schriftzug „slopify“. (14.11.2026)
- **Sprachmodell für den KI-Chat:** Claude. (Kristof, 14.11.2026)

- **Was soll als Nächstes sichtbar werden: Shop-Editor oder KI-Chat?** Editor. Der KI-Chat (Welle 2) folgt danach. (Kristof, 12.11.2026)
- **Fragen 1 bis 9 vom 06.–09.11.2026** (gesperrter Shop lesbar, Änderungsprotokoll für Mitarbeiter, Notweg Zwei-Faktor, Zwei-Faktor für Händler, Ablaufdatum API-Token, E-Mail bei neuem Token, E-Mail „Passwort geändert“, Mitarbeiter laden ein, E-Mail bei angenommener Einladung): für das MVP egal. Es bleibt, wie es gebaut ist; nichts davon wird weiter verfolgt. Grundsatz seitdem: nur noch fragen, wenn die Antwort etwas Sichtbares ändert (CLAUDE.md 1a). (Kristof, 09.11.2026)
- **Welle 1 komplett mit allen Rechtspflichten?** Neu entschieden: nein. Es ist nur ein Test für Kristof und Kollegen; Rechtspflichten und alles, was nur echte Händler brauchen, kommt in die Liste „Später“. (Kristof, 09.11.2026; ersetzt die Antwort vom 27.10.2026)

- **Kästchen „Angemeldet bleiben“ bei der Händler-Anmeldung?** Nein. Es gilt immer: 12 Stunden ohne Aktivität, höchstens 7 Tage. (06.11.2026)
- **Ungefähren Ort in der Liste „Aktive Sitzungen“ anzeigen?** Nein, nicht jetzt (Antwort „nein“, verstanden als „später“). Die Liste zeigt Gerät, Browser und Zeitpunkt. (06.11.2026)
- **Nach 20 falschen Passwörtern auch das ganze Netz sperren?** Nein (gegen die Empfehlung). Das Netz wird nur gebremst (höchstens 60 Sekunden Wartezeit), gesperrt wird nur das einzelne Konto. Umgesetzt am selben Tag. (06.11.2026)

- **Kranken Hintergrunddienst automatisch neu starten?** Ja (gegen die Empfehlung „Nein“). Umgesetzt ohne Wächter mit Docker-Zugriff: Der Worker beendet sich nach 3 Minuten am Stück „krank“ selbst, Docker startet ihn neu. (05.11.2026)

- **Was gehört ins Änderungsprotokoll?** Alles, auch Aktionen der Kunden im Shop (Warenkorb, Konto, Bestellungen). Der Subscriber `audit.record` hört deshalb weiter auf alle Ereignisse. (05.11.2026)

- **Wie lange bleiben Einträge im Änderungsprotokoll?** Unbegrenzt, es wird nichts automatisch gelöscht. (05.11.2026)

- **Container-Scan auch bei fremden Bausteinen streng?** So lassen: Nur kritische Lücken mit Korrektur in den eigenen Abbildern (api, migrate) lassen den Scan scheitern, fremde Abbilder werden nur berichtet und über Dependabot aktualisiert. (04.11.2026)

- **Wann kann ich etwas sehen?** Früher als geplant: eine Vorschau der Storefront mit Beispieldaten (Teeladen) auf dem Testserver, noch ohne Kaufen. Das Fundament verschiebt sich dadurch um etwa einen Lauf. (04.11.2026)

- **Öffentlicher Testserver?** Neu entschieden: Ja, damit Kristof einen Link an Kollegen schicken kann (vorher 27.10.2026: nein). Anbieter: Oracle Cloud, Gratisangebot („Always Free“). Kristof hat das Konto am 03.11.2026 angelegt. Den Server selbst legt er erst an, wenn es etwas zu sehen gibt (mit E18), weil Oracle ungenutzte Gratis-Server nach 7 Tagen abschalten darf. (03.11.2026)

- **Rhythmus?** Ab 04.11.2026 zwei Läufe am Tag (05:47 und 13:47 Uhr), Ziel: MVP in rund sechs Wochen. (03.11.2026)

- **Dokumentationsseite der API jetzt oder später?** Später, als eigener kleiner Dienst nur für die Entwicklung. (03.11.2026)

- **E4 auf zwei Läufe aufteilen?** Bis zum Lauf am 03.11.2026 keine Antwort. Gebaut wurde Teil 1 (Gerüst mit Beispiel-Endpunkten), weil er bei beiden Antworten der erste Schritt ist; Teil 2 (restliche Schutzmechanismen) folgt im nächsten Lauf. Will Kristof es anders, genügt ein Satz im Chat. (03.11.2026)

- **Testcontainers jetzt oder mit E4?** Jetzt, als eigene Etappe vor E4. (01.11.2026)
- **Sprache der Fehlermeldungen in der API?** Beide: Deutsch und Englisch schon ab Welle 1, die Sprache richtet sich nach der Anfrage. Bedingung: Es darf nicht viele Credits kosten. Umsetzung daher schlank: eine Texttabelle je Fehlercode in zwei Sprachen, Deutsch als Standard. (30.10.2026)
- **Rechtstext-Vorlagen?** Vorlagen mit Platzhaltern, gefüllt aus den Firmendaten. (29.10.2026)
- **Wann verfällt eine unbezahlte Bestellung?** Nach 24 Stunden automatisch storniert. (29.10.2026)
- **Ware schon im Warenkorb reservieren?** Nein, erst bei der Bestellung. (29.10.2026)
- **Kleinunternehmerregelung in Welle 1?** Nein, später. (29.10.2026)
- **Stil des Standard-Designs?** Schlicht. (29.10.2026)
- **Testshops?** Teeladen und Modeladen passen. (29.10.2026)

- **Better Auth behalten?** Ja, behalten, mit den nötigsten Funktionen, fester Version und wöchentlicher Prüfung. (28.10.2026)
- **Rechnungen 8 oder 10 Jahre aufbewahren?** 10 Jahre, wie im ursprünglichen Auftrag (mehr als gesetzlich nötig). (28.10.2026)
- **Betreiberkonto in Welle 1 mit Zwei-Faktor?** Ja, schon in Welle 1. (28.10.2026)
- **Öffentlicher Testserver?** Nein, nur lokal und in Tests. (27.10.2026, am 03.11.2026 geändert, siehe oben)
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
