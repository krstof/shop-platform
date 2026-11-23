# Wunschliste und Fahrplan

Alles, was Kristof sich für Slopify wünscht, sortiert nach Paketen. Die Liste vom 22.11.2026 (diktiert) ist hier vollständig eingearbeitet, zusammen mit dem, was vorher schon offen war. `STATUS.md` verweist auf diese Datei; der Abschnitt „Stand und nächste Schritte“ bleibt dort.

**Lesehilfe:** „Gibt es schon“ heißt, der Wunsch ist bereits gebaut und Kristof hat ihn vielleicht nur noch nicht gefunden. Jedes Paket ist ein Lauf oder zwei, nicht mehr.

## Entschieden am 22.11.2026 (abends)

- **Eigenes CSS und eigenes HTML:** raus, bleibt draußen.
- **JavaScript im Shop:** erlaubt, aber nur ein kleines eigenes Skript für Zoom, Video und Suchvorschläge. Nichts von fremden Servern, und jede Seite funktioniert ohne das Skript weiter.
- **Übersetzung:** über das eingebundene KI-Modell, nicht über DeepL. Es kennt den Zusammenhang des Shops und ist schon da.
- **Logo erzeugen:** Das eingebundene Modell kann kein Foto erzeugen, aber es kann ein Logo als SVG zeichnen (Schrift, Form, Farbe als Code). Für ein Wort-Bild-Zeichen reicht das; für ein gemaltes Motiv nicht. Vorerst: hochladen plus erzeugtes SVG.
- **Einrichtungs-Assistent:** kommt später, als Chat mit möglichst vielen anklickbaren Antworten. Beim ersten Schritt sucht er Bilder bei Unsplash und schreibt passende Texte („ich verkaufe Stoff und Garn“ → Bühnenbild mit Stoffen, „Willkommen in unserem Stoffladen“). Das erste Produkt legt er noch nicht an.
- **Wort:** Das Bedienelement heißt **Button**, nicht „Knopf“. ✅ Am 22.11.2026 überall umbenannt.

## Reihenfolge

Kristof hat am 22.11.2026 ausdrücklich gesagt: **Branchen-Startpunkte will er nicht** (früher Punkt 36.5, gestrichen).

Am Abend des 22.11.2026 hat er die Reihenfolge neu gesetzt. Sie gilt vor allen früheren Angaben:

| Rang | Paket | Inhalt |
|---|---|---|
| ✅ fertig | P13 | Formatierung in Textfeldern (fett, kursiv, Listen, Link), dazu P14 (Beispieltexte im Editor) |
| halb fertig | P3 | Analytics-Seite ✅ 23.11.2026; SEO-Seite offen (braucht Zugangsdaten) |
| wichtig | P5 | Produktpflege: Editor, Video, Zoom, Schlüsselwörter, Mindestbestand |
| wichtig | P6 | Assistent: eigene Seite, Benachrichtigungen, Report, Einstellungen |
| wichtig | P10 | Sprachen und automatische Übersetzung, Steuersätze |
| mittel | P11 | Aussehen: Produktkarte zentral, Textfarbe, Kopfzeilen-Varianten |
| hinten | P2 | Produktvarianten (zuletzt, ausdrücklich) |
| hinten | P4 | Slopify als MCP-Server |
| hinten | P7 | Shop-Detailseite in der Plattform-Verwaltung, mit Anmelde-Link in den Shop |
| hinten | P8 | Kaufen: Mindestbestellwert, Warenkorb-Rabatte, Suchvorschläge, Suchfilter |
| hinten | P9 | Versandarten, Versandkosten, Zahlungs- und Versandlogos, Mollie |
| ✅ fertig | P1, P12 | Kleinigkeiten (22.11.2026) und Einstellungen je Baustein (22.11.2026) |

## P1 Sofort sichtbare Kleinigkeiten ✅ fertig am 22.11.2026

- ✅ **Fehler: abmelden, obwohl man nicht angemeldet ist.** Im Backoffice erscheint „Bitte anmelden“, im Benutzermenü oben rechts steht trotzdem „Abmelden“. Das Menü muss den Zustand der Sitzung kennen.
- ✅ **Kopfzeile im Backoffice:** Statt „Inhaber:in“ unter dem Shopnamen soll dort nur der Shopname stehen, daneben das Favicon des Shops.
- ✅ **Favicon hochladen** unter „Einstellungen → Allgemein“; der Shop nimmt heute ein festes Symbol.
- ✅ **Posteingang nach oben.** Der Posteingang steht im Menü links; er soll zusätzlich oben neben dem Benutzersymbol als Briefumschlag mit der Zahl der ungelesenen Nachrichten erscheinen.
- ✅ **Einstellungen springen nicht mehr.** Beim Wechsel zwischen Allgemein, Versand, Anbindungen und Team wandert die Überschrift, weil jeder Reiter eine andere Breite hat. Eine feste Breite für alle Reiter.
- ✅ **„Knopf“ heißt jetzt „Button“** (erledigt 22.11.2026).
- ✅ **„Testshop“-Band raus, USP-Leiste rein.** Ganz oben im Shop steht heute fest „Testshop: Hier ist nichts echt, auch die Zahlung nicht.“ Das wird eine einstellbare Leiste mit bis zu drei kurzen Zusagen (Versand, Rückgabe, Beratung), ein- und ausschaltbar in der Kopfzeile. Der Testhinweis bleibt dort voreingestellt, solange nichts eingetragen ist.

## P2 Produktvarianten

Größe und Farbe mit eigenem Preis, eigenem Bestand und eigener Artikelnummer. Betrifft Datenmodell, Katalog-API, Produkt-Editor, Produktseite, Warenkorb und Kasse. Bilder je Variante stehen schon auf der Liste „Später“ und kommen hier dazu.

## P3 Statistiken und SEO

Zwei neue Menüpunkte unter „Onlineshop“, nicht im Dashboard und nicht unter Einstellungen (Kristof, 22.11.2026).

**Seite „Analytics“**

- ✅ Umsatz, Bestellungen, durchschnittlicher Warenkorb über einen wählbaren Zeitraum (7, 30, 90 Tage), als Balken je Tag.
- ✅ Seitenaufrufe je Tag und meistbesuchte Seiten. **Ohne Plausible:** Der Server der Storefront zählt selbst, ohne Cookie und ohne JavaScript. Plausible bräuchte ClickHouse und einen eigenen Dienst und zeigt dasselbe. Was dadurch fehlt: Besucher (statt Aufrufe), Verweildauer, Absprünge und Herkunft — alles Dinge, die ohne Wiedererkennung nicht gehen.
- ✅ Meistverkaufte Produkte. Umsatz je Kategorie fehlt noch (bräuchte den Katalog neben den Bestellungen).

**Seite „SEO“**

- **Probleme finden:** Der Shop wird durchgegangen und meldet fehlende Seitentitel, zu lange oder zu kurze Beschreibungen, Produkte ohne Beschreibung, Bilder ohne Alternativtext, doppelte Titel, fehlende Überschriften.
- **Suchbegriffe verfolgen:** Begriffe eintragen und ihre Entwicklung verfolgen, Daten von **DataForSEO**.
- **Eigene Platzierungen:** Wo steht der Shop zu diesen Begriffen, und wie verändert sich das?
- **Google Search Console** anbinden: Suchanfragen, Klicks, Darstellungen auf derselben Seite.
- **XML-Sitemap** je Shop, die sich automatisch aktualisiert, plus Eintrag in der robots.txt. Gibt es heute nicht.
- **Titel und Beschreibung je Seite** samt Vorschau des Google-Eintrags.
- Steigt eine Platzierung deutlich, meldet das der Assistent (siehe P6).

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
- Ausklapp-Symbol oben neben „Schließen“ in der Blase, das auf diese Seite führt, und daneben ein Zahnrad, das direkt zu den Assistenten-Einstellungen führt.
- Blase ein- und ausschaltbar, voreingestellt an.
- Benachrichtigungen, je einzeln an- und abschaltbar: neue Bestellung, neue Nachricht im Posteingang, Mindestlagerbestand unterschritten, Analytics (auffällige Ausschläge), SEO (Platzierung deutlich gestiegen oder gefallen).
- Weitere Fähigkeiten (Kristof am 22.11.2026 zugestimmt): Gegenfragen stellen statt raten, „mach die letzte Änderung rückgängig“, mehrere Produkte auf einmal ändern, von sich aus Vorschläge machen (höchstens einmal am Tag, nur an Zahlen hängend), Fragen zum Shop beantworten.
- Report in wählbarem Abstand (Tage, Wochen, Monate): meistverkaufte Produkte, Umsatz, Besucher.
- Einrichtungs-Assistent für einen neuen Shop.

## P7 Shop-Detailseite in der Plattform-Verwaltung

Eine Seite je Shop mit Zahlen, Inhaberin, Tarif, Zustand und den Buttons zum Sperren und Entsperren.

- **Anmelde-Link in den Shop** (Kristof 22.11.2026): Aus der Plattform-Verwaltung heraus mit einem Klick im Backoffice des Shops landen, ohne das Passwort der Inhaberin zu kennen. Technisch ein kurzlebiger Einmal-Link, den nur ein Betreiberkonto erzeugen darf; der Shop merkt sich im Protokoll, dass der Betrieb und nicht die Inhaberin gearbeitet hat.

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

## P11 Aussehen

- **Produktkarte zentral einstellen:** Bildformat (quadratisch, hochkant, Originalverhältnis) und ob Preis, Hersteller und „In den Warenkorb" auf der Karte stehen. Einmal für den ganzen Shop, nicht je Baustein (aus P12 übrig).
- **Produkte von Hand auswählen** auch bei „Neu im Shop" und „Bestseller", so wie es bei „Empfehlungen" schon geht (aus P12 übrig).
- **Schriftfarbe wählbar** (heute: Hauptfarbe, Hintergrundfarbe, zwei Schriften). Klein und sinnvoll.
- **Mehrere Kopfzeilen-Designs** zur Auswahl, so wie es heute vier Design-Vorlagen gibt.
- **Google Maps:** Gibt es schon als Baustein „Karte“.
- **Fragen und Antworten zum Ausklappen:** Gibt es schon; der Baustein „Fragen“ klappt im Shop auf und zu, ganz ohne JavaScript.
- **Soziale Netzwerke in der Fußzeile:** Gibt es schon.
- **Kopfzeile einstellbar:** Gibt es schon (Suche offen, als Lupe oder aus; Kopf bleibt beim Scrollen stehen).

## P12 Einstellungen je Baustein ✅ fertig am 22.11.2026

Kristofs Wunsch vom 22.11.2026: „es sollte natürlich nicht 10.000 Einstellungen geben", aber mehr als heute. Shopifys Horizon-Themes lösen das mit wenigen Einstellungen, die bei **jedem** Baustein gleich heißen, plus einer Handvoll eigener je Art. Genau so hier:

**Bei jedem Baustein (Zahnrad):**

1. **Abstand oben und unten** (klein, mittel, groß). Erspart die Abstands-Bausteine dazwischen.
2. **Breite** (Seitenbreite oder randlos über die ganze Fläche).
3. **Ausrichtung** (links oder mittig), nur bei Bausteinen mit Text.

**Bei Produktlisten (Empfehlungen, Neu im Shop, Bestseller, Kategorien):**

4. **Wie viele** zeigen (2 bis 12).
5. **Spalten am Computer** (2, 3 oder 4). Am Handy bleiben es zwei.
6. **Button „Alle ansehen"** an oder aus, mit Ziel. Dazu gehört eine neue Seite `/<shop>/produkte`, auf der alle Produkte stehen; die gibt es heute nicht.
7. **Produkte selbst auswählen** auch bei „Neu im Shop" und „Bestseller", nicht nur bei „Empfehlungen" (dort gibt es das schon).

**Einmal zentral für die Produktkarte, nicht je Baustein:**

8. Bildformat (quadratisch, hochkant, Originalverhältnis).
9. Preis, Hersteller und „In den Warenkorb" auf der Karte an oder aus.

Nicht übernommen von Shopify: Farbschemata je Abschnitt (zu viel für diesen Shop), Karussell auf dem Handy (bräuchte JavaScript ohne Nutzen), Höhe je Abschnitt (macht Layouts kaputt).

**Gebaut am 22.11.2026:** Punkt 1 bis 6, dazu die neue Seite `/<shop>/produkte`. Offen bleiben
Punkt 7 (Produkte von Hand auswählen auch bei „Neu im Shop" und „Bestseller") sowie 8 und 9
(Bildformat und Inhalt der Produktkarte, zentral einstellbar). Beides sind eigene Schritte und
stehen jetzt in P11.

## P14 Beispieltexte im Editor stehen wirklich da ✅ fertig am 22.11.2026

Kristof am 22.11.2026: Im Editor steht in der Bühne „Willkommen bei Teeladen“, aber das ist nur ein
Platzhalter. Sobald er hineinklickt und tippt, ist der Satz weg und er schreibt auf einem leeren
Feld. Er möchte den Text wirklich dort stehen haben und ihn ändern können wie jeden anderen.

Gilt für alle Stellen, an denen der Shop heute einen Standardtext einsetzt: Überschrift und Text der
Bühne sowie die Überschriften von Empfehlungen, Neu im Shop, Bestseller und Kategorien.

## P13 Formatierung in Textfeldern ✅ fertig am 22.11.2026

Kristof möchte in allen Textfeldern formatieren können. Vorschlag mit Maß:

- **In mehrzeiligen Feldern** (Textbaustein, Text mit Bild, Antwort im Fragen-Baustein, Produktbeschreibung): fett, kursiv, unterstrichen, Aufzählung, nummerierte Liste, Link.
- **In einzeiligen Feldern** (Überschriften, Beschriftungen, Schritte): keine Formatierung. Eine Überschrift mit drei Schriftgrößen darin sieht in jedem Shop schlecht aus.
- **Keine Schriftart, Schriftgröße und Textfarbe je Textstelle.** Die gehören in die Design-Einstellungen, damit der Shop zusammenbleibt. Wer sie je Absatz setzen kann, baut sich unbemerkt ein Durcheinander.

Gespeichert wird kein HTML, sondern eine kleine, geprüfte Auszeichnung; der Shop setzt daraus sein eigenes HTML. Sonst wäre es dasselbe Loch wie bei einem HTML-Baustein.

**Gebaut am 22.11.2026** als Paket `@shop/text`: `**fett**`, `*kursiv*`, `- ` und `1. ` für Listen, `[Text](Adresse)` für Links. Im Editor gibt es dafür eine Leiste über dem Feld; unterstrichen fehlt mit Absicht, weil unterstrichener Text im Web wie ein Link aussieht.

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
5. **Startseite mit Inhalt.** Er setzt Bühne, Vertrauenszeile, Empfehlungen und „So geht's“ zusammen und füllt sie: Bilder sucht er bei Unsplash zum ersten Satz („Stoff und Garn“ → Stoffe, Garnrollen, Nähtisch), Texte schreibt er dazu („Willkommen in unserem Stoffladen“). Kristof ändert oder bestätigt.
6. **Fertig.** „Dein Shop steht. Willst du ihn ansehen oder gleich veröffentlichen?“ Das erste Produkt legt der Assistent nicht an (Kristof, 22.11.2026); das kommt später.

**Was er nicht tut.** Er fragt nichts ab, was er selbst herausfinden kann, und er erledigt nichts ohne Bestätigung. Jeder Schritt lässt sich überspringen.

**Technisch.** Der Assistent ruft dieselben Endpunkte der Admin-API auf wie die Oberfläche, nichts Eigenes. Der Stand steht im Shop (`setup_step`), damit er nach dem Schließen weitermacht. Das Logo zeichnet das eingebundene Modell als SVG (Schrift, Form, Farbe als Code); ein gemaltes Motiv kann es nicht, dafür bleibt das Hochladen.

## Offene Fragen an Kristof

Offen ist nur noch: Mit welchem Paket geht es los? Alles andere ist entschieden (siehe oben).
