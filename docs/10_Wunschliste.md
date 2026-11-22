# Wunschliste und Fahrplan

Alles, was Kristof sich für Slopify wünscht, sortiert nach Paketen. Die Liste vom 22.11.2026 (diktiert) ist hier vollständig eingearbeitet, zusammen mit dem, was vorher schon offen war. `STATUS.md` verweist auf diese Datei; der Abschnitt „Stand und nächste Schritte“ bleibt dort.

**Lesehilfe:** „Gibt es schon“ heißt, der Wunsch ist bereits gebaut und Kristof hat ihn vielleicht nur noch nicht gefunden. Jedes Paket ist ein Lauf oder zwei, nicht mehr.

## Reihenfolge

Kristof hat am 22.11.2026 ausdrücklich gesagt: **Branchen-Startpunkte will er nicht** (früher Punkt 36.5, gestrichen). Vorrang haben MCP-Server, Plausible, Google Search Console, DataForSEO, Produktvarianten und die Shop-Detailseite in der Plattform-Verwaltung.

| Paket | Inhalt | Warum an dieser Stelle |
|---|---|---|
| P1 | Sofort sichtbare Kleinigkeiten und ein Fehler | Eine Stunde Arbeit, jeden Tag sichtbar |
| P2 | Produktvarianten | Größter fehlender Brocken im Katalog, von Kristof genannt |
| P3 | Statistiken und SEO-Anbindungen | Von Kristof genannt: Plausible, Google Search Console, DataForSEO, Sitemap |
| P4 | Slopify als MCP-Server | Von Kristof genannt |
| P5 | Produktpflege: Editor, Video, Zoom, Schlüsselwörter, Mindestbestand | Was ein Händler täglich anfasst |
| P6 | Assistent: eigene Seite, Benachrichtigungen, Report, Einrichtung | Großes eigenes Thema, Konzept steht unten |
| P7 | Shop-Detailseite in der Plattform-Verwaltung | Von Kristof genannt, kleiner als die anderen |
| P8 | Kaufen: Mindestbestellwert, Warenkorb-Rabatte, Suchvorschläge, Suchfilter | Verkaufslogik, hängt teils an Varianten |
| P9 | Versandarten, Versandkosten, Zahlungs- und Versandlogos, Mollie | Hängt zusammen, größerer Brocken |
| P10 | Sprachen und automatische Übersetzung, Steuersätze | Größter Brocken, betrifft jedes Modul |
| P11 | Aussehen: Textfarbe, Kopfzeilen-Varianten, eigenes CSS | Offene Entscheidung, siehe unten |

## P1 Sofort sichtbare Kleinigkeiten

- **Fehler: abmelden, obwohl man nicht angemeldet ist.** Im Backoffice erscheint „Bitte anmelden“, im Benutzermenü oben rechts steht trotzdem „Abmelden“. Das Menü muss den Zustand der Sitzung kennen.
- **Kopfzeile im Backoffice:** Statt „Inhaber:in“ unter dem Shopnamen soll dort nur der Shopname stehen, daneben das Favicon des Shops.
- **Favicon hochladen** unter „Einstellungen → Allgemein“; der Shop nimmt heute ein festes Symbol.
- **Posteingang nach oben.** Der Posteingang steht im Menü links; er soll zusätzlich oben neben dem Benutzersymbol als Briefumschlag mit der Zahl der ungelesenen Nachrichten erscheinen.
- **Einstellungen springen nicht mehr.** Beim Wechsel zwischen Allgemein, Versand, Anbindungen und Team wandert die Überschrift, weil jeder Reiter eine andere Breite hat. Eine feste Breite für alle Reiter.
- **„Testshop“-Band raus, USP-Leiste rein.** Ganz oben im Shop steht heute fest „Testshop: Hier ist nichts echt, auch die Zahlung nicht.“ Das wird eine einstellbare Leiste mit bis zu drei kurzen Zusagen (Versand, Rückgabe, Beratung), ein- und ausschaltbar in der Kopfzeile. Der Testhinweis bleibt dort voreingestellt, solange nichts eingetragen ist.

## P2 Produktvarianten

Größe und Farbe mit eigenem Preis, eigenem Bestand und eigener Artikelnummer. Betrifft Datenmodell, Katalog-API, Produkt-Editor, Produktseite, Warenkorb und Kasse. Bilder je Variante stehen schon auf der Liste „Später“ und kommen hier dazu.

## P3 Statistiken und SEO

- **Plausible oder Umami** auf einer neuen Seite „Statistiken“ im Backoffice (Besucher, Seiten, Herkunft), selbst gehostet, ohne Cookies.
- **Google Search Console** anbinden: Property bestätigen, Suchanfragen und Klicks auf derselben Seite zeigen.
- **DataForSEO** für Keyword-Daten.
- **XML-Sitemap** je Shop, die sich automatisch aktualisiert, plus Eintrag in der robots.txt. Gibt es heute nicht.
- **SEO-Reiter** unter „Einstellungen“: Titel und Beschreibung je Seite, Vorschau des Google-Eintrags, Weiterleitungen.

## P4 Slopify als MCP-Server

Der Shop wird für fremde KI-Programme ansprechbar, so wie der ePages-Shop-Conductor. Steht in `docs/09_Anbindungen.md` als Welle C.

## P5 Produktpflege

- **Editor für die Produktbeschreibung:** fett, kursiv, Aufzählung, Links, Überschriften. Heute ist das Feld reiner Text.
- **Video statt oder neben Bildern:** „Bild oder Video hinzufügen“, mit Schalter für automatisches Abspielen. ⚠️ Braucht JavaScript im Shop; bisher kommt der Shop ohne aus. Eigene Entscheidung nötig.
- **Zoom auf dem Produktbild** beim Überfahren mit der Maus. Braucht ebenfalls JavaScript.
- **Neu-Markierung:** Schalter am Produkt, der im Shop ein „Neu“-Schildchen auf der Karte zeigt.
- **Schlüsselwörter für die Shop-Suche** je Produkt, damit ein Produkt auch unter Wörtern gefunden wird, die nicht im Text stehen.
- **Mindestlagerbestand** je Produkt, und eine Meldung, sobald er unterschritten ist (siehe P6, Benachrichtigungen).
- **Streichpreise:** Gibt es schon. Trägt man einen Angebotspreis ein, zeigt der Shop den alten Preis durchgestrichen daneben.

## P6 Assistent

Siehe das Konzept weiter unten. Kurz:

- Eigene Seite „Assistent“ unter „Einstellungen“ mit demselben Chat in voller Breite, gleiche Unterhaltung wie in der Blase.
- Ausklapp-Symbol oben links neben „Schließen“ in der Blase, das auf diese Seite führt.
- Blase ein- und ausschaltbar, voreingestellt an.
- Benachrichtigungen: neue Bestellung, neue Nachricht im Posteingang, Mindestlagerbestand unterschritten.
- Report in wählbarem Abstand (Tage, Wochen, Monate): meistverkaufte Produkte, Umsatz, Besucher.
- Einrichtungs-Assistent für einen neuen Shop.

## P7 Shop-Detailseite in der Plattform-Verwaltung

Eine Seite je Shop mit Zahlen, Inhaberin, Tarif, Zustand und den Knöpfen zum Sperren und Entsperren.

## P8 Kaufen und Suchen

- **Mindestbestellwert** je Shop; die Kasse weist darunter ab.
- **Warenkorb-Rabatte:** Staffel nach Warenwert, etwa 10 % ab 100 Euro.
- **Suchvorschläge beim Tippen.** Kristofs Regel: Die eingegebenen Buchstaben müssen am Anfang eines Wortes stehen, „an“ findet also nicht „Vanille“, „va“ schon. Braucht JavaScript im Shop.
- **Suchfilter** (Preis, Kategorie, Verfügbarkeit) auf der Trefferseite.
- **Sortieren:** Gibt es schon.
- **Wunschliste:** Gibt es schon als Merkzettel, ohne Kundenkonto, über ein Cookie.
- **Warenkorb bleibt erhalten:** Gibt es schon, ebenfalls über ein Cookie.
- **Kundenkonto mit Anmeldung:** Gibt es noch nicht und ist Voraussetzung dafür, dass Merkzettel und Warenkorb geräteübergreifend gelten.

## P9 Versand und Zahlung

- Versandarten und Versandkosten (Gewicht, Zonen, mehrere Arten).
- **Zahlungs- und Versandlogos in der Fußzeile**, aufgebaut wie die sozialen Netzwerke heute: eine Liste zum Anschalten, ohne Verlinkung. Dazu die Möglichkeit, eigene Logos hochzuladen.
- Mollie als zweiter Zahlungsanbieter, DHL als Versanddienstleister.

## P10 Sprachen und Steuern

- **Internationalisierung** unter „Einstellungen“: Sprachen auswählen, in denen der Shop erscheint.
- **Automatische Übersetzung** aller Texte (Produkte, Kategorien, Seiten, Bausteine) beim Speichern. DeepL hat eine kostenlose Stufe mit 500.000 Zeichen im Monat; das eingebundene KI-Modell kann dasselbe und ist schon da. ❓ Entscheidung offen.
- **Steuersätze einstellbar** statt der zwei festen Klassen „Standard“ und „ermäßigt“.

## P11 Aussehen, offene Entscheidung

- **Schriftfarbe wählbar** (heute: Hauptfarbe, Hintergrundfarbe, zwei Schriften). Klein und sinnvoll.
- **Mehrere Kopfzeilen-Designs** zur Auswahl, so wie es heute vier Design-Vorlagen gibt.
- **Eigenes CSS** ⚠️ Empfehlung: nicht bauen. Begründung in `STATUS.md` und im Chat vom 22.11.2026. Kurz: Eigenes CSS bricht bei jeder Änderung am Shop, die Hilfeseite dazu wäre ein eigenes Projekt, und jeder Wunsch, der dadurch erfüllt würde, ist als Einstellung besser aufgehoben.
- **Eigenes HTML** als Baustein ⚠️ Empfehlung: nicht bauen. Fremdes HTML im Shop hebelt die Sicherheitsregeln aus (keine Skripte, keine fremden Quellen), die den Shop heute schützen.
- **Google Maps:** Gibt es schon als Baustein „Karte“.
- **Fragen und Antworten zum Ausklappen:** Gibt es schon; der Baustein „Fragen“ klappt im Shop auf und zu, ganz ohne JavaScript.
- **Soziale Netzwerke in der Fußzeile:** Gibt es schon.
- **Kopfzeile einstellbar:** Gibt es schon (Suche offen, als Lupe oder aus; Kopf bleibt beim Scrollen stehen).

## Bewusst nicht gebaut

| Wunsch | Grund |
|---|---|
| Countdown | Bräuchte JavaScript im Shop; im Featurekatalog „Vielleicht später“ (MKT-18) |
| Newsletter-Anmeldung | Braucht Double-Opt-in mit Bestätigungsmail, Welle 5 (MKT-08) |
| Anbindung an eBay und Amazon | Von Kristof selbst zurückgestellt |
| Branchen-Startpunkte | Von Kristof am 22.11.2026 gestrichen |

## Konzept: Einrichtungs-Assistent

**Wann er kommt.** Beim ersten Anmelden in einem leeren Shop, statt des heutigen leeren Dashboards. Später jederzeit erreichbar unter „Einstellungen → Assistent“. Abbrechen ist immer möglich, der Fortschritt bleibt erhalten.

**Wie er aussieht.** Eine Seite, links der Chat, rechts die Vorschau des Shops, die sich bei jeder Antwort sofort mitändert. Kein Formular mit zwölf Feldern, sondern ein Gespräch mit Knöpfen: Der Assistent fragt, Kristof tippt oder klickt eine der vorgeschlagenen Antworten. Unten eine Fortschrittsanzeige mit sechs Schritten.

**Die sechs Schritte.**

1. **Was verkaufst du?** Ein Satz genügt. Daraus leitet der Assistent Vorschläge für alles Weitere ab.
2. **Name und Adresse des Shops.** Vorschläge, falls noch kein Name feststeht; die Adresse (`/kuerzel`) schlägt er aus dem Namen vor.
3. **Logo.** Hochladen, oder vom Assistenten erzeugen lassen. Drei Entwürfe zur Auswahl, dann verfeinern („schlichter“, „anderes Symbol“, „andere Farbe“). Daraus zieht der Assistent gleich das Favicon.
4. **Farben und Schrift.** Aus dem Logo schlägt er eine Hauptfarbe vor und zeigt drei fertige Paare aus Schrift und Farbe. Ein Klick übernimmt eines.
5. **Startseite.** Er setzt Bühne, Vertrauenszeile, Empfehlungen und „So geht's“ mit Beispieltexten zusammen, die zum ersten Satz passen, und fragt nach einem Bild für die Bühne (hochladen oder aus der Bildersuche).
6. **Erstes Produkt.** Name, Preis, Bild; Beschreibung schreibt der Assistent und lässt sie bestätigen. Danach: „Dein Shop steht. Willst du ihn ansehen oder gleich veröffentlichen?“

**Was er nicht tut.** Er fragt nichts ab, was er selbst herausfinden kann, und er erledigt nichts ohne Bestätigung. Jeder Schritt lässt sich überspringen.

**Technisch.** Der Assistent ruft dieselben Endpunkte der Admin-API auf wie die Oberfläche, nichts Eigenes. Der Stand steht im Shop (`setup_step`), damit er nach dem Schließen weitermacht. Das Erzeugen des Logos braucht ein Bildmodell; die eingebundene KI kann heute nur Text. ❓ Entscheidung offen.

## Offene Fragen an Kristof

Stehen im Chat vom 22.11.2026 und in `FRAGEN.md`, sobald beantwortet.
