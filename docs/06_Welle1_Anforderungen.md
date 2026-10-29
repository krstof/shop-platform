# Anforderungskatalog Welle 1 (MVP Deutschland)

Stand: 29.10.2026, Antworten von Kristof vom selben Tag eingearbeitet. Zweck: Dieses Dokument legt für jede der 63 Funktionen der Welle 1 fest, **was genau** gebaut wird, was nur „wäre gut“ ist und was bewusst später kommt. Außerdem legt es die **Bau-Reihenfolge** fest, in der die täglichen Läufe vorgehen. Es baut auf dem Featurekatalog (`docs/02_Featurekatalog.md`), der Architektur (`docs/03_Architektur.md`), dem Datenmodell (`docs/04_Datenmodell.md`) und dem Sicherheitskonzept (`docs/05_Sicherheit.md`) auf.

**Disclaimer:** Rechtliche Punkte sind technische Anforderungen nach Recherche vom 29.10.2026 und keine Rechtsberatung. Die Plattform bleibt ein privates Experiment ohne echte Kunden.

---

## Inhalt

1. So liest man dieses Dokument
2. Ziel von Welle 1: Wann ist sie fertig?
3. Anforderungen, die für alle Funktionen gelten
4. Anforderungen je Funktion
5. Bau-Reihenfolge (26 Etappen)
6. Ergebnisse der Recherche vom 29.10.2026
7. Entscheidungen von Kristof

---

## 1. So liest man dieses Dokument

Alle 63 Funktionen der Welle 1 sind im Featurekatalog „Muss“. Innerhalb jeder Funktion gibt es aber Einzelheiten, die unterschiedlich wichtig sind. Deshalb ist jede Funktion hier in drei Stufen zerlegt:

| Stufe | Bedeutung |
|---|---|
| **Muss** | Wird in Welle 1 gebaut und automatisch getestet. Ohne diesen Punkt gilt die Funktion als nicht fertig. |
| **Wäre gut** | Wird in Welle 1 gebaut, wenn die Etappe ohne großen Mehraufwand Platz dafür hat. Sonst rutscht der Punkt in Welle 2. |
| **Vielleicht später** | Wird in Welle 1 bewusst **nicht** gebaut. Das Datenmodell lässt ihn aber ohne Umbau zu. |

- ⚠ markiert besonders aufwendige oder fehleranfällige Punkte.
- **E-Nummern** (zum Beispiel E10) verweisen auf die Etappe in Kapitel 5, in der der Punkt gebaut wird.
- **T-Nummern** (zum Beispiel T-14) verweisen auf die automatischen Sicherheitstests in `docs/05_Sicherheit.md` Kapitel 7.
- **Kapitelangaben wie „Sicherheit 5.2“** verweisen auf das Sicherheitskonzept.

---

## 2. Ziel von Welle 1: Wann ist sie fertig?

Welle 1 ist fertig, wenn dieser Ablauf **automatisch im Browser** (Playwright) durchläuft, jedes Mal grün:

1. Der Betreiber meldet sich mit Passwort und Zwei-Faktor-Code in der Plattform-Verwaltung an und legt einen Händler mit Shop „teeladen“ an.
2. Der Händler bekommt eine Einladung per E-Mail, setzt sein Passwort und meldet sich im Backoffice an.
3. Er trägt Firmendaten ein, füllt die Rechtstexte aus, legt einen Hersteller, eine Kategorie und ein Produkt mit Bild, Preis, Grundpreis, Lieferzeit und Bestand an und veröffentlicht es.
4. Er schaltet den Shop online. Das geht nur, wenn alle Pflichtangaben vollständig sind.
5. Ein Gast öffnet `teeladen.shop.localhost`, findet das Produkt über das Menü, legt es in den Warenkorb, gibt seine Adresse ein, wählt Versand und Test-Zahlung, bestätigt die AGB und klickt „zahlungspflichtig bestellen“.
6. Auf der Test-Bezahlseite klickt er „Erfolg“. Die Bestellung wird erst durch die signierte Rückmeldung „bezahlt“.
7. Der Gast bekommt eine Bestellbestätigung mit allen Pflichtangaben, Widerrufsbelehrung und Muster-Widerrufsformular. Der Händler bekommt eine Meldung im Backoffice und per E-Mail.
8. Der Händler markiert die Bestellung als versendet und zugestellt.
9. Der Gast widerruft über den Widerrufsbutton im Shop und bekommt sofort eine Eingangsbestätigung mit Datum und Uhrzeit. Der Widerruf erscheint an der Bestellung.
10. Ein zweiter Shop „modeladen“ sieht bei keinem dieser Schritte Daten von „teeladen“ (Isolationstests auf Datenbank- und API-Ebene).

Zusätzlich müssen alle Prüfungen aus `pnpm check` grün sein, alle Seiten der Storefront die automatischen Barrierefreiheitstests (axe-core, WCAG 2.1 AA) bestehen und die Sicherheitstests T-01 bis T-16 sowie T-18 bis T-20 vorhanden und grün sein.

---

## 3. Anforderungen, die für alle Funktionen gelten

Diese Querschnitts-Anforderungen stehen nicht bei jeder einzelnen Funktion, gelten aber überall. Sie stammen aus Architektur und Sicherheitskonzept.

### 3.1 API und Daten

| Nr. | Anforderung | Quelle |
|---|---|---|
| Q-01 | Jede Funktion ist zuerst ein Endpunkt der Admin-, Storefront- oder Platform-API. Oberflächen benutzen nur diese APIs, nie die Datenbank direkt. | API-01, API-02 |
| Q-02 | Jeder Endpunkt hat ein strenges Zod-Schema für Ein- und Ausgabe. Unbekannte Felder ergeben `422`. Felder wie `tenantId`, `id`, `status`, `version` sind in Eingaben gar nicht vorhanden. | Sicherheit 5.4, T-12 |
| Q-03 | Jeder Endpunkt erklärt seine Berechtigung (`x-required-scopes`). Fehlt sie, scheitert der Build. Standard ist „verboten“. | Sicherheit 5.3, T-09 |
| Q-04 | Jeder Datenbankzugriff mit Shopdaten läuft in `withTenantTransaction`. Fremde IDs ergeben `404`, nie `403`. | Sicherheit 5.1, T-08 |
| Q-05 | Fehler im Format „Problem Details“ (RFC 9457) mit `requestId`, ohne interne Einzelheiten. | Architektur 4.9 |
| Q-06 | Änderbare Datensätze haben `version`, die API liefert `ETag` und verlangt `If-Match`. | Architektur 4.6 |
| Q-07 | Listen mit Cursor, höchstens 100 Einträge pro Seite. | Architektur 4.7 |
| Q-08 | Geld immer als `{ amount, currency }` in Cent, Steuersätze in Basispunkten. Für Geld-, Steuer-, Preis- und Bestandsregeln werden die Tests zuerst geschrieben. | ADR-006, Architektur 8.4 |
| Q-09 | Jede ändernde Aktion schreibt einen Audit-Eintrag und, wo andere Module es brauchen, ein Ereignis in die Outbox, in derselben Transaktion. | ADR-007, PLA-07 |
| Q-10 | Texte für Kunden werden mit Sprachcode gespeichert (nur `de` in Welle 1). Oberflächentexte kommen aus Übersetzungsdateien. | Featurekatalog A-07 |

### 3.2 Sicherheit

| Nr. | Anforderung | Quelle |
|---|---|---|
| Q-11 | Anfragen höchstens 1 MB (Bilder separat), Texte mit Höchstlänge, Datenbankabfragen höchstens 5 Sekunden. | Sicherheit 5.4, 5.8 |
| Q-12 | Kein freies HTML: formatierter Text wird strukturiert gespeichert und nur mit einer festen Liste erlaubter Elemente ausgegeben. `set:html` und `dangerouslySetInnerHTML` sind per Lint verboten (eine getestete Ausnahme). | Sicherheit 5.4, T-13 |
| Q-13 | Sicherheits-Header und CSP auf allen Oberflächen, CSP zuerst im Modus „nur melden“. | Sicherheit 5.5, T-20 |
| Q-14 | Ändernde Anfragen mit Sitzung prüfen `Origin` bzw. `Sec-Fetch-Site`. Die Admin-API nimmt nur JSON an. | Sicherheit 5.5, T-11 |
| Q-15 | Anfragebremse je Bereich mit den Startwerten aus Sicherheit 5.8. **Neu:** IPv6-Adressen werden für die Bremse auf ihr `/64`-Netz gekürzt, damit ein Angreifer nicht durch Wechsel der Adresse ausweicht (Lehre aus CVE-2026-45364, Kapitel 6.5). | Sicherheit 5.8, T-18 |
| Q-16 | Protokolle schwärzen Passwörter, Tokens, Cookies und volle IP-Adressen automatisch. | Sicherheit 5.12, T-19 |
| Q-17 | Weiterleitungen nur auf relative Pfade oder eigene Domains des Shops. | Sicherheit 5.5 |
| Q-18 | CSV-Exporte schützen vor Formel-Einschleusung. | Sicherheit 5.4 |

### 3.3 Oberflächen

| Nr. | Anforderung | Quelle |
|---|---|---|
| Q-19 | Storefront und Checkout erfüllen WCAG 2.1 AA, soweit automatisch prüfbar, plus eine Handprüfung je Seitentyp mit Tastatur. Backoffice und Plattform-Verwaltung: gleiche Bausteine, axe-core-Test, aber nicht rechtlich verpflichtend. | STR-11 |
| Q-20 | Alle Oberflächen funktionieren auf Handy, Tablet und Computer (zuerst fürs Handy gebaut). | EDI-01 |
| Q-21 | Kurze, klare deutsche Texte, Fehlermeldungen sagen, was zu tun ist. | CLAUDE.md |

---

## 4. Anforderungen je Funktion

### 4.1 Plattform-Verwaltung und Betrieb

| ID | Muss | Wäre gut | Vielleicht später | Etappe |
|---|---|---|---|---|
| **PLA-01** Plattform-Admin-Oberfläche | Liste aller Händler und Shops mit Status, Tarif, Anlagedatum, Zahl der Produkte und Bestellungen (nur Zahlen, keine Shopdaten). Eigene Adresse `platform.localhost`. Tägliche Zusammenfassung auffälliger Sicherheitsereignisse (Sicherheit 5.12). | Suche und Filter in der Liste | Auswertungen, Umsatzgrafiken, Chat-Bedienung (Welle 2) | E7, E21 |
| **PLA-02** Händler und Shops anlegen, sperren, löschen | Anlegen mit Voreinstellungen (Deutschland, Euro, 19/7 %, Test-Zahlung, Pauschalversand, Standardlager, Kanal „Storefront“, Kundengruppe „Endkunden“, Rechtstext-Entwürfe, Nummernkreise). Einladung des Inhabers per E-Mail. Sperren zeigt eine neutrale Seite im Shop und sperrt das Backoffice. Löschen nur mit Bestätigung durch Eintippen des Shopnamens, Ablauf nach Datenmodell 5.4 (Belege bleiben 10 Jahre). | Wiederherstellen innerhalb von 30 Tagen nach dem Löschen | Selbst-Registrierung von Händlern, Umzug eines Shops zu einem anderen Händler | E7, E21 |
| **PLA-03** Mandantentrennung | RLS mit `FORCE` auf allen Shoptabellen (umgesetzt), `withTenantTransaction` als einziger Zugang, Mandant in Speicherpfaden, Jobs und Zwischenspeicher-Schlüsseln, Hostnamen normalisiert. Tests T-01, T-02, T-08 automatisch für **jede** Tabelle und **jeden** Endpunkt. ⚠ T-08 als Generator aus OpenAPI | – | Schema oder Datenbank pro Mandant (Architektur 5.8) | E3, E4, laufend |
| **PLA-04** Händler-Login und Kontoeinstellungen | Anmeldung, Abmeldung, Passwort vergessen, Passwort und E-Mail ändern (mit erneuter Passworteingabe und Bestätigung an alte und neue Adresse), Name ändern, aktive Sitzungen sehen und beenden. Alle Regeln aus Sicherheit 5.2. | E-Mail bei Anmeldung von unbekanntem Gerät | Passkeys und Zwei-Faktor für Händler (Welle 2) | E6, E18 |
| **PLA-05** Kostenlose Subdomain | Jeder Shop ist unter `<name>.shop.localhost` erreichbar. Name: 3 bis 40 Zeichen, nur `a–z`, `0–9`, Bindestrich, nicht am Anfang oder Ende. Sperrliste reservierter Namen (`www`, `api`, `admin`, `platform`, `media`, `pay`, `mail` und Ähnliche). Ein Hostname gehört genau einem Shop. | Namensvorschlag aus dem Shopnamen | Eigene Domains der Händler (Welle 2 oder später) | E7 |
| **PLA-06** Plattform-Grundeinstellungen | Mailserver und Objektspeicher kommen aus Umgebungsvariablen und werden beim Start geprüft. Die Plattform-Verwaltung zeigt sie nur lesend an (ohne Geheimnisse). | Testmail-Knopf | KI-Modell einstellen (Welle 2), Einstellungen in der Oberfläche ändern | E7, E21 |
| **PLA-07** Änderungsprotokoll | Jede ändernde Aktion mit Urheber (Mensch, Token, System), Zeit, Objekt, gekürzter IP. Unveränderlich (umgesetzt). Händler sieht das Protokoll seines Shops, Betreiber das der Plattform. | Filter nach Objekt und Urheber | Rückgängig machen einer Aktion (mit KI, Welle 2) | E5, E20 |
| **BET-01** Automatische Updates | Migrationen laufen beim Start im Dienst `migrate`, vorwärts und nur nach erfolgreichen Tests. Jede Migration ist rückwärtskompatibel zur vorigen Programmversion. | – | Updates ohne Ausfallzeit mit mehreren Instanzen | E3, E25 |
| **BET-02** Selbst betreibbar mit einem Befehl | `pnpm dev` startet alles lokal, erzeugt `.env` mit Zufallspasswörtern, legt Testshops „teeladen“ und „modeladen“ an. Container ohne Administratorrechte (Sicherheit 5.16). | `docker compose up -d` mit fertigen Abbildern | Helm-Charts für Kubernetes | E1 |
| **BET-03** Datensicherung | Nächtlicher `pg_dump` und Kopie des Objektspeichers, verschlüsselt mit age, 14 Tage. Wöchentlicher Wiederherstellungstest mit Isolationstest. | – | pgBackRest mit Zeitpunkt-Wiederherstellung | E25 |
| **BET-04** Dateispeicher | Garage mit S3-Schnittstelle hinter einer eigenen Schnittstelle im Modul `media`. Pfade nur aus Mandant und UUID. | – | Mehrere Speicherknoten | E1, E9 |
| **BET-05** Hintergrundaufgaben | pg-boss in PostgreSQL, Outbox-Relay, Wiederholung mit wachsenden Abständen, Jobs tragen den Mandanten. Fehlgeschlagene Jobs sind für den Betreiber sichtbar. | – | Eigener Nachrichtenbus | E5 |

### 4.2 Händler-Backoffice

| ID | Muss | Wäre gut | Vielleicht später | Etappe |
|---|---|---|---|---|
| **EIN-01** Allgemeine Einstellungen | Shopname, Firmenname, Rechtsform, Anschrift, E-Mail, Telefon, Vertretungsberechtigte, Registergericht und -nummer, USt-IdNr., Logo (kein SVG). Diese Daten füllen Impressum, E-Mails und Bestellungen automatisch. | Hinweis, welche Pflichtangaben noch fehlen | Daten aus Visitenkarten-Foto lesen (KI, Welle 2) | E8, E18 |
| **EIN-02** Shop online oder offline | Schalter mit Prüfliste: online nur, wenn Firmendaten, alle Pflicht-Rechtstexte, mindestens eine Versandart und eine Zahlungsart vorhanden sind. Offline zeigt eine Wartungsseite mit Impressum (Status `503`, `noindex`). | Vorschau-Link für den Händler, solange der Shop offline ist | Zeitgesteuertes Online-Schalten | E8, E18 |
| **PRD-01** Produkte anlegen | Name, Beschreibung (strukturierter Text), Artikelnummer, Preis, Steuerklasse, Bestand, Bilder, Kategorien, Hersteller, Lieferzeit, Grundpreis-Angaben, Gewicht, wesentliche Merkmale. Jedes Produkt hat genau eine Standard-Variante (A-05). Artikelnummer pro Shop eindeutig. | Produkt duplizieren | Varianten, Produkttypen, Zusatzfelder in der Oberfläche (Welle 2) | E10, E19 |
| **PRD-02** Produkt bearbeiten | Eigene Seite mit allen Angaben, Speichern mit `If-Match` (kein unbemerktes Überschreiben), Archivieren statt Löschen bei Produkten mit Bestellungen. | Ungespeicherte Änderungen werden beim Verlassen angemahnt | Änderungsverlauf je Produkt | E10, E19 |
| **PRD-03** Produktübersicht | Liste mit Nummer, Bild, Name, Preis, Bestand, Status. Sortieren nach Name, Preis, Bestand, Datum. Filter nach Status und Kategorie. Name, Preis und Bestand direkt in der Liste ändern. | Mehrfachauswahl zum Veröffentlichen oder Archivieren | Produktsuche (Welle 2), CSV-Import und -Export | E10, E19 |
| **PRD-04** Entwurf oder veröffentlicht | Status `draft`, `published`, `archived`. Veröffentlichen nur mit Name, Preis, Steuerklasse, Lieferzeit und Hersteller-Angaben. Nur veröffentlichte Produkte erscheinen in der Storefront-API. | – | Zeitgesteuertes Veröffentlichen | E10 |
| **PRD-05** Produktbilder | Bis zu 10 Bilder je Produkt, Reihenfolge änderbar, Alternativtext Pflicht vor dem Veröffentlichen (Barrierefreiheit). Hochladen über signierte Adressen, Prüfung am Inhalt, Neu-Kodierung mit sharp, Größen 320/640/1024/1600 px in WebP und AVIF, Grenzen 50 Megapixel und 20 MB, kein SVG (Sicherheit 5.7, T-16). | Bildausschnitt wählen | Bildbearbeitung und Hintergrund entfernen mit KI (Welle 2) | E9, E19 |
| **PRS-01** Preis mit Steuerklasse | Ein Bruttopreis in Euro pro Variante für Kanal „Storefront“ und Gruppe „Endkunden“, gespeichert in der Preistabelle (A-02). Jede Änderung landet im Preisverlauf (A-03). Steuerklasse „normal“ oder „ermäßigt“. | Streichpreis („statt“) mit Pflicht-Hinweis auf 30-Tage-Tiefstpreis | Staffel-, Gruppen- und Aktionspreise (Welle 2 und 3) | E11 |
| **KAT-01** Kategorien | Kategorien mit Name, Beschreibung, Bild, Adresse, Reihenfolge, eine Unterebene. Produkte in mehrere Kategorien. Kategorien bilden das Hauptmenü. | Reihenfolge per Ziehen | Mehr als zwei Ebenen, automatische Kategorien nach Regeln | E10, E19 |
| **LAG-01** Bestandsführung | Bestand je Variante im Standardlager. Reservierung erst beim Bestellen, nicht schon im Warenkorb (Entscheidung Kristof), mit Prüfregel in der Datenbank (umgesetzt), Abbuchung nach Zahlung, Freigabe bei Abbruch. Bewegungsprotokoll. Einstellung je Produkt „Bestand führen ja/nein“. | Warnung bei niedrigem Bestand | Mehrere Lager, Vorbestellung | E11 |
| **BUH-01** Nummernkreise | Bestell-, Kunden-, Widerrufs- und Rechnungsnummern pro Shop mit Präfix und Mindeststellen (z. B. `B-10001`). Lückenlos und parallel sicher (getestet). Format änderbar, solange noch keine Nummer vergeben ist. | – | Jahreswechsel im Format (`2027-…`) | E8 |

### 4.3 Storefront, Warenkorb und Checkout

| ID | Muss | Wäre gut | Vielleicht später | Etappe |
|---|---|---|---|---|
| **EDI-01** Responsives Standard-Design | Ein festes, **schlichtes** Design (Entscheidung Kristof) aus Abschnitten und Bausteinen (ADR-005), gespeichert als JSON. Händler kann Logo, Hauptfarbe und Schrift aus einer Liste wählen. Kontraste werden geprüft: Eine Farbe mit zu wenig Kontrast wird abgelehnt (WCAG). Ladezeit der Produktseite auf dem Handy unter 2,5 Sekunden (LCP) im Test. | Zwei Schriftpaare zur Auswahl | Visueller Editor (Welle 2) | E22 |
| **EDI-02** Footer mit Pflichtseiten | Impressum, AGB, Widerruf, Datenschutz, Versand und Zahlung, Barrierefreiheitserklärung und der **Widerrufsbutton** stehen auf jeder Seite, nicht entfernbar. Eigene Links darunter ergänzbar und sortierbar. | – | – | E12, E22 |
| **INH-01** Einfache Textseiten | Seiten mit Titel, Adresse und Text, gespeichert als Bausteine. Entwurf und veröffentlicht. | Vorschau | Bilder und weitere Bausteine (Welle 2) | E12, E20 |
| **STF-01** Grundgerüst der Storefront | Startseite (Kategorien und neueste Produkte), Kategorieseite mit seitenweiser Liste, Produktseite, Warenkorb, Checkout, Bestellbestätigung, Inhaltsseiten, Widerrufsseite, 404-Seite. Alles serverseitig erzeugt, funktioniert ohne JavaScript. Daten nur über die Storefront-API. | Sortierung in der Kategorie | Suche, Filter (Welle 2) | E22, E23 |
| **STF-02** Produktdarstellung | Bilder mit Alternativtext, Name, Preis mit Pflichtangaben (STR-02), Grundpreis, Lieferzeit, Verfügbarkeit, Beschreibung, wesentliche Merkmale, Produktsicherheit (STR-10). | Bildergalerie mit Vergrößerung | Bewertungen, ähnliche Produkte | E22 |
| **WKC-01** Warenkorb | Hinzufügen, Menge ändern (1 bis 999), entfernen. Warenkorb-Token wie in Sicherheit 5.6. Preise werden bei jedem Abruf neu berechnet, Änderungen seit dem Hinzufügen werden angezeigt. Der Warenkorb reserviert keine Ware. Ist ein Produkt beim Bestellen ausverkauft, sieht der Kunde einen klaren Hinweis. Warenkorb gilt 30 Tage. | Kleiner Warenkorb-Hinweis ohne Seitenwechsel | Merkzettel, Warenkorb teilen | E14, E23 |
| **WKC-02** Sicherer, rechtskonformer Checkout | Eine Seite mit Abschnitten: E-Mail, Rechnungs- und Lieferadresse, Versandart, Zahlart, Übersicht mit wesentlichen Merkmalen (STR-04), Gesamtpreis mit Steuer und Versand, Lieferzeit, Hinweis auf AGB und Widerruf mit Links, Knopf „zahlungspflichtig bestellen“ (STR-06). Server rechnet alles neu, Abweichung erfordert erneute Bestätigung. `Idempotency-Key` Pflicht. Verstecktes Prüffeld gegen CSRF. Bremse 60 Anfragen je Minute (Sicherheit 5.6, T-14). ⚠ Ablauf über mehrere Module mit Kompensation | Adresse prüfen (Postleitzahl passt zum Ort) | Express-Checkout, Bot-Schutz im Browser (ALTCHA) | E15, E23 |
| **WKC-03** Bestellung als Gast | Bestellen nur mit E-Mail und Adresse, Gastkunde wird angelegt (`kind = guest`). | – | Konto mit einem Klick nach der Bestellung (Welle 2) | E15 |
| **MKT-01** Sprechende Adressen | `/kategorie/<slug>`, `/produkt/<slug>`, `/seite/<slug>`. Slugs aus dem Namen erzeugt, pro Shop eindeutig. Ändert sich ein Slug, entsteht automatisch eine dauerhafte Weiterleitung (301). Kanonische Adresse und Seitentitel auf jeder Seite. | Seitenbeschreibung (Meta Description) pflegbar | Sitemap, strukturierte Daten (Welle 2) | E10, E22 |
| **KAN-01** Verkaufskanäle | Es gibt den Kanal „Storefront“. Preise, Sichtbarkeit und Bestellungen hängen an ihm. Die Storefront-API ermittelt den Kanal aus dem Shop. | – | Weitere Kanäle (Welle 4 und 5) | E8 |

### 4.4 Bestellungen, Zahlung und Versand

| ID | Muss | Wäre gut | Vielleicht später | Etappe |
|---|---|---|---|---|
| **BST-01** Bestellübersicht | Liste mit Nummer, Datum, Kunde, Summe, Bestell-, Zahlungs- und Versandstatus. Filter nach Status. Unbearbeitete Bestellungen hervorgehoben. | CSV-Export (mit Schutz Q-18) | Gespeicherte Filter | E15, E20 |
| **BST-02** Bestelldetails mit Verlauf | Unveränderliche Kopie von Positionen, Preisen, Steuern, Adressen, Versand, Zahlart und den Versionen der akzeptierten Rechtstexte. Zeitleiste aller Ereignisse inkl. Widerrufe. Interne Notizen des Händlers. | Druckansicht | Bestellung bearbeiten (Welle 2) | E15, E20 |
| **BST-03** Status ändern | Getrennte Status für Bestellung (offen, in Bearbeitung, abgeschlossen, storniert), Zahlung (offen, bezahlt, fehlgeschlagen, erstattet) und Versand (offen, versendet, zugestellt). Erlaubte Übergänge als feste Regel, ungültige ergeben `409`. „Bezahlt“ von Hand nur für Zahlarten ohne Rückmeldung (in Welle 1 keine) und mit Audit-Eintrag. Stornieren gibt Bestand frei. | Sendungsnummer beim Versenden | Teillieferung, Erstattung über den Zahlungsanbieter (Welle 2) | E15, E20 |
| **BST-04** Benachrichtigung bei neuer Bestellung | Meldung im Backoffice (Glocke mit Zähler) und E-Mail an den Shop. | – | Push aufs Handy | E16, E20 |
| **BST-05** Bestellbestätigung per E-Mail | Sofort nach dem Bestellen: Bestellnummer, Positionen mit wesentlichen Merkmalen, Preise, Steuer, Versand, Gesamtsumme, Adressen, Lieferzeit, Zahlart, Firmendaten des Händlers, AGB, Widerrufsbelehrung und Muster-Widerrufsformular (STR-07), Link zum Widerrufsbutton. Klarer Hinweis, ob die Zahlung schon eingegangen ist. | Versandbestätigung | Rechnungs-PDF im Anhang (Welle 2) | E16 |
| **ZAH-01** Test-Zahlung | Eigener Dienst `pay.localhost` mit gehosteter Bezahlseite und drei Knöpfen: Erfolg, Ablehnung, Abbruch. Schickt signierte Rückmeldungen (HMAC-SHA256 mit Zeitstempel). | Knopf „Rückmeldung verzögern“, um langsame Anbieter zu simulieren | Erstattung über die Testzahlung | E13 |
| **ZAH-02** Austauschbare Zahlungs-Schnittstelle | Feste Adapter-Schnittstelle (`createSession`, `verifyWebhook`, `getStatus`, später `refund`). Signatur, Alter und Doppelte werden geprüft, Betrag und Währung müssen passen, Status nie aus dem Browser (Sicherheit 5.6, T-15). Unbezahlte Bestellungen werden nach 24 Stunden automatisch storniert, der Bestand wird freigegeben (Frist als Einstellung, Entscheidung Kristof). | – | Stripe und weitere Anbieter (ab Welle 2) | E13 |
| **VER-01** Eigene Versandarten | Versandarten mit Name, Beschreibung, Preis, Versandkostenfreigrenze, Lieferland Deutschland. Mindestens eine aktiv. Abholung als eigene Art ohne Adresse. | Versandkosten nach Gewicht | Versanddienstleister-Anbindung, Etiketten | E13 |

### 4.5 Deutsches Recht

| ID | Muss | Wäre gut | Vielleicht später | Etappe |
|---|---|---|---|---|
| **STR-01** Steuersätze und Steuerklassen | Sätze in einer Tabelle pro Land mit Gültigkeitsdatum (19 % und 7 %). Berechnung zeilenweise aus Bruttopreisen, kaufmännisch gerundet, Steuer auch auf Versandkosten nach dem Anteil der Waren. Tests zuerst. | – | Kleinunternehmerregelung (später, Entscheidung Kristof), andere Länder (Welle 4) | E8 |
| **STR-02** Preisangaben | Bei jedem Preis „inkl. MwSt., zzgl. Versandkosten“, wobei „Versandkosten“ auf die Seite Versand und Zahlung verweist. | – | – | E22 |
| **STR-03** Grundpreis | Füllmenge und Einheit (g, kg, ml, l, m, m², m³, Stück). Anzeige pro 1 kg, 1 l, 1 m usw. (bei bis zu 250 g oder ml auch pro 100 g oder ml möglich). Überall dort, wo der Preis steht. Tests zuerst. | – | Grundpreis aus Etikettenfoto (KI) | E10, E22 |
| **STR-04** Wesentliche Merkmale | Je Produkt ein kurzes Feld „wesentliche Merkmale“ (Pflicht beim Veröffentlichen). Steht im Checkout direkt über dem Bestellknopf und in der Bestellung. | – | – | E10, E23 |
| **STR-05** Rechtstexte-Seiten | Impressum, AGB, Widerrufsbelehrung, Muster-Widerrufsformular, Datenschutz, Versand und Zahlung, **Barrierefreiheitserklärung** (neu, Kapitel 6.3). Jede Änderung wird als Version gespeichert, die Bestellung merkt sich die Version. Impressum wird aus EIN-01 erzeugt. Neue Shops bekommen Vorlagen mit Platzhaltern, die aus den Firmendaten gefüllt werden, mit dem deutlichen Hinweis, dass es keine geprüften Rechtstexte sind (Entscheidung Kristof). Warnung im Backoffice, solange ein Text fehlt oder ein Platzhalter offen ist. | – | Anbindung von Rechtstext-Diensten | E12, E20 |
| **STR-06** Button-Lösung | Der Knopf heißt fest „zahlungspflichtig bestellen“, nicht änderbar. Test prüft die Beschriftung. | – | – | E23 |
| **STR-07** Widerrufsbelehrung und -formular | In der Bestellbestätigung als Text (nicht nur als Link), dazu die AGB. | AGB zusätzlich als PDF | – | E16 |
| **STR-08** Widerrufsbutton (§ 356a BGB) | Siehe eigene Anforderungen in Kapitel 6.1. ⚠ rechtlich neu, genau umsetzen | – | – | E17, E23 |
| **STR-09** Lieferzeit | Pflichtfeld je Produkt als Spanne in Werktagen („Lieferzeit 2 bis 4 Werktage“), Standardwert im Shop. Anzeige auf Produktseite, im Warenkorb, im Checkout und in der Bestätigung. | Anderer Text, wenn nicht vorrätig | Lieferdatum statt Spanne | E10 |
| **STR-10** Produktsicherheit (GPSR) | Hersteller als eigener Datensatz mit Name, Postanschrift und elektronischem Kontakt (E-Mail oder Kontaktseite). Bei Herstellern außerhalb der EU zusätzlich die verantwortliche Person in der EU. Je Produkt ein Produktkennzeichen (Typ, Modell oder Charge) und Warn- und Sicherheitshinweise. Anzeige direkt auf der Produktseite, nicht nur als Link oder PDF. | Herstellerdaten mehreren Produkten auf einmal zuordnen | Sicherheitsdatenblätter als PDF | E10, E22 |
| **STR-11** Barrierefreiheit (BFSG) | WCAG 2.1 AA (Maßstab EN 301 549): Tastatur, Fokus sichtbar, Überschriften-Reihenfolge, Formular-Beschriftungen und Fehlermeldungen, Kontraste, Alternativtexte, Sprache `de`, keine Zeitlimits im Checkout. axe-core in jedem Seitentyp, Handprüfung je Seitentyp. Barrierefreiheitserklärung als Pflichtseite. ⚠ zieht sich durch alle Oberflächen | Prüfung nach WCAG 2.2 AA | – | E22, E23, E24 |

### 4.6 Sicherheit und API

| ID | Muss | Wäre gut | Vielleicht später | Etappe |
|---|---|---|---|---|
| **SIC-01** HTTPS | Caddy mit lokal erzeugten Zertifikaten, Weiterleitung von HTTP auf HTTPS, interne Dienste nicht von außen erreichbar. | – | Let's Encrypt (erst mit öffentlichem Server) | E1 |
| **SIC-02** Sichere Anmeldung | Argon2id mit mindestens 19 MiB, 2 Durchläufen, Parallelität 1 (bestätigt, Kapitel 6.4). Passwortregeln nach NIST mit Liste bekannter Passwörter. Bremse und Sperre wie Sicherheit 5.2. Gleiche Antwort und Antwortzeit bei unbekannter E-Mail. Better Auth mit eigener Rolle `shop_auth`, nur E-Mail und Passwort sowie Zwei-Faktor für den Betreiber eingeschaltet (T-10, T-11). | E-Mail bei Anmeldung von unbekanntem Gerät | Passkeys (Welle 2) | E6 |
| **SIC-03** Rollen und Berechtigungen | Betreiber (eigene API, Zwei-Faktor Pflicht), Händlerrollen `owner` und `staff` (Sicherheit 5.3), anonymer Kunde. Schnittmenge aus Rolle und Token. Erneute Passworteingabe für kritische Aktionen nach 15 Minuten. Mitarbeiter einladen und entfernen. | – | Eigene Rollen (Welle 5), Support-Zugriff (Welle 5) | E6, E18 |
| **SIC-04** Schutz vor typischen Angriffen | Querschnitt Q-02, Q-11 bis Q-14, Q-17, Q-18. Schemathesis gegen alle Endpunkte (T-12), XSS-Testwerte in allen Textfeldern (T-13). | OWASP-ZAP-Scan vor Abschluss der Welle (T-21) | – | E4, E24 |
| **SIC-05** Begrenzung von Anfragen | Startwerte aus Sicherheit 5.8 im Arbeitsspeicher, `429` mit `Retry-After`, IPv6 auf `/64` gekürzt (Q-15), T-18. | – | Valkey bei mehreren Instanzen | E4 |
| **SIC-06** Geheimnisse | Nur in `.env`, Startprüfung auf Länge und Vollständigkeit, Hauptschlüssel für TOTP-Geheimnisse (Envelope Encryption), gitleaks (T-06). | – | SOPS und age auf einem Server | E1, E2, E6 |
| **SIC-07** Keine Kartendaten | Zahlungsdaten nur auf der Bezahlseite des (Test-)Anbieters. Kein Feld für Kartendaten in Datenbank oder API. | – | – | E13 |
| **SIC-08** Abhängigkeiten prüfen | Feste Versionen, `onlyBuiltDependencies`, Wartezeit 7 Tage (`minimumReleaseAge: 10080` Minuten, Kapitel 6.4), OSV-Scanner und `pnpm audit` bei jedem Push, Dependabot wöchentlich, Actions mit Commit-Kennung (T-07). Wöchentliche Prüfung der Better-Auth-Sicherheitsmeldungen. | SBOM wöchentlich | – | E1 |
| **API-01** Vollständige Admin-API | Jede Funktion des Backoffice als Endpunkt mit `operationId`, Beschreibung, Beispielen und Berechtigung. API-Token mit Berechtigungen (Sicherheit 5.2). ⚠ Umfang | – | OAuth für Apps (Welle 4) | E4 bis E17 |
| **API-02** Storefront-API | Lesen von Shopdaten, Kategorien, Produkten, Seiten, Rechtstexten; Warenkorb, Checkout, Widerruf. Mandant aus dem Hostnamen. Gibt nur veröffentlichte Daten heraus, keine internen Felder (Kosten, Notizen). | Öffentlicher Storefront-Schlüssel für fremde Frontends | CORS für fremde Domains (Welle 4) | E14, E15, E17 |
| **API-03** API-Dokumentation | OpenAPI aus den Zod-Schemas, eingecheckt, Scalar-Oberfläche unter `api.localhost/docs`, oasdiff in der CI. | – | Öffentliches Entwicklerportal | E4 |

---

## 5. Bau-Reihenfolge (26 Etappen)

**Grundregel:** zuerst das Fundament (Werkzeuge, Datenbank, Sicherheit), dann die Fachmodule in der Reihenfolge ihrer Abhängigkeiten, zuletzt die Oberflächen. So steht jede Funktion zuerst als getestete API, bevor eine Oberfläche sie benutzt. Eine Etappe entspricht ungefähr einem täglichen Lauf. Mit ⚠ markierte Etappen können zwei Läufe brauchen.

| Etappe | Inhalt | Funktionen | Fertig, wenn |
|---|---|---|---|
| **E1** | Grundgerüst: Monorepo (pnpm, Turborepo), Docker Compose mit Caddy, PostgreSQL, Garage, Mailpit, `.env`-Erzeugung, CI mit gitleaks, OSV-Scanner, `pnpm audit`, pnpm-Lieferkettenregeln | BET-02, BET-04, SIC-01, SIC-06, SIC-08 | Alle Container starten, CI ist grün, ein absichtlich eingebautes Test-Geheimnis wird von gitleaks gefunden |
| **E2** | `packages/kernel`: Geld, Steuer-Basispunkte, UUIDv7, Problem Details, Konfigurationsprüfung, Protokoll mit Schwärzung, `withTenantTransaction` | Q-05, Q-08, Q-16 | Unit-Tests grün, T-19 grün |
| **E3** ⚠ | Migrationen: `db/schema_welle1.sql` auf die Module aufteilen, `migrate`-Dienst, Isolations- und Rechtetest in Testcontainers, kysely-codegen je Modul, dependency-cruiser-Regeln | PLA-03, BET-01 | T-01 bis T-05 laufen in der CI, Modulgrenzen werden geprüft |
| **E4** ⚠ | API-Gerüst: NestJS mit Fastify, Zod-OpenAPI, globaler Rechte-Wächter, Prüfung `x-required-scopes`, Idempotenz, ETag, Cursor, Anfragebremse, Sicherheits-Header, Scalar, oasdiff, Generatoren für T-08 und T-09 | API-01 (Gerüst, wächst bis E17), API-03, SIC-04, SIC-05, Q-01 bis Q-07 | Ein Beispiel-Endpunkt besteht T-08, T-09, T-12 (kurz) und T-18 |
| **E5** | Outbox, Relay, pg-boss im `worker`, Modul `audit` mit Lesen-Endpunkt | PLA-07, BET-05 | Ein Ereignis kommt genau einmal beim Abonnenten an, auch bei Wiederholung |
| **E6** ⚠ | Modul `identity`: Better Auth mit `shop_auth`, Anmeldung, Bremse, Sitzungen, Einladungen, Passwort vergessen, Zwei-Faktor für den Betreiber, Mitgliedschaften und Rollen, API-Token | PLA-04, SIC-02, SIC-03 | T-10, T-11 grün, Zwei-Faktor-Anmeldung im Test |
| **E7** | Modul `platform`: Händler, Shops, Subdomains, Hostname-Auflösung, Shop mit Voreinstellungen anlegen, sperren, löschen, Platform-API | PLA-01, PLA-02, PLA-05, PLA-06 | Neuer Shop hat alle Voreinstellungen, gesperrter Shop ist nicht erreichbar |
| **E8** | Module `shop-settings` und `tax`: Firmendaten, online/offline mit Prüfliste, Kanal, Land und Zone, Nummernkreise, Steuerberechnung | EIN-01, EIN-02, KAN-01, BUH-01, STR-01 | Steuer-Tests mit Rundungsfällen grün |
| **E9** | Modul `media`: signierte Upload-Adressen, Prüfung, sharp, Bildgrößen, Auslieferung über `media.localhost` | PRD-05, BET-04 | T-16 grün |
| **E10** ⚠ | Modul `catalog`: Produkte mit Standard-Variante, Status, Kategorien, Hersteller (GPSR), Lieferzeit, Grundpreis, wesentliche Merkmale, Slugs mit Weiterleitungen | PRD-01 bis PRD-04, KAT-01, STR-03, STR-04, STR-09, STR-10, MKT-01 | Admin-Endpunkte vollständig, Grundpreis-Tests grün |
| **E11** | Module `pricing` und `inventory`: Preise, Preisverlauf, Bestand, Reservierung, Abbuchung, Freigabe | PRS-01, LAG-01 | Kein Überverkauf bei 20 gleichzeitigen Käufen des letzten Stücks |
| **E12** | Modul `content`: Seiten, Rechtstexte mit Versionen, Impressum aus Firmendaten, Pflichtseiten-Prüfung, Menüs, Footer | INH-01, STR-05, EDI-02 | Shop kann ohne vollständige Rechtstexte nicht online gehen |
| **E13** | Module `shipping` und `payments` plus Dienst `test-payment-provider` | VER-01, ZAH-01, ZAH-02, SIC-07 | T-15 grün, alle drei Knöpfe der Bezahlseite getestet |
| **E14** | Modul `cart` und lesende Storefront-API | WKC-01, API-02 | Warenkorb rechnet Preise und Steuern serverseitig |
| **E15** ⚠ | Module `checkout`, `orders`, `customers`: Workflow „Bestellung aufgeben“, Gastkunde, Momentaufnahme, Status, Ablauf unbezahlter Bestellungen | WKC-02, WKC-03, BST-01 bis BST-03 | T-14 grün, Ablauf aus Architektur 3.5 vollständig per API getestet |
| **E16** | Modul `notifications`: E-Mail-Vorlagen, Versand im Hintergrund, Meldungen im Backoffice | BST-04, BST-05, STR-07 | Bestätigungsmail mit allen Pflichtangaben kommt in Mailpit an |
| **E17** | Widerrufsfunktion nach § 356a BGB | STR-08 | Alle Punkte aus Kapitel 6.1 automatisch getestet |
| **E18** | Backoffice Teil 1: Gerüst, Anmeldung, Konto, Team, Einstellungen, online/offline | PLA-04, EIN-01, EIN-02, SIC-03 | Ende-zu-Ende-Test Anmeldung und Einstellungen |
| **E19** | Backoffice Teil 2: Produkte, Bilder, Kategorien, Hersteller, Produktübersicht | PRD-01 bis PRD-05, KAT-01 | Produkt mit Bild per Oberfläche angelegt und veröffentlicht |
| **E20** | Backoffice Teil 3: Bestellungen, Widerrufe, Seiten, Rechtstexte, Änderungsprotokoll, Meldungen | BST-01 bis BST-04, INH-01, STR-05, PLA-07 | Bestellung per Oberfläche als versendet markiert |
| **E21** | Plattform-Verwaltung: Anmeldung mit Zwei-Faktor, Händler und Shops, Einstellungen, Sicherheitszusammenfassung | PLA-01, PLA-02, PLA-06 | Shop per Oberfläche angelegt und gesperrt |
| **E22** ⚠ | Storefront Teil 1: Design-Bausteine, Start-, Kategorie-, Produkt- und Inhaltsseiten, Footer, Preisangaben, Produktsicherheit | EDI-01, EDI-02, STF-01, STF-02, STR-02, STR-10, MKT-01 | axe-core ohne Befund, T-20 grün |
| **E23** ⚠ | Storefront Teil 2: Warenkorb, Checkout, Bestellbestätigung, Widerrufsseite | WKC-01, WKC-02, STR-04, STR-06, STR-08 | Kauf ohne JavaScript und mit Tastatur möglich |
| **E24** | Barrierefreiheit und Sicherheit im Ganzen: Handprüfung je Seitentyp, XSS-Test, Barrierefreiheitserklärung | STR-11, SIC-04 | T-13 grün, Prüfprotokoll in `docs/` |
| **E25** | Betrieb: nächtliche Sicherung, wöchentlicher Wiederherstellungstest, Update-Ablauf | BET-01, BET-03 | Wiederherstellung inkl. Isolationstest automatisch grün |
| **E26** | Abschluss Welle 1: der Ablauf aus Kapitel 2 als Ende-zu-Ende-Test, Testdaten, Rückblick, Plan für Welle 2 | alle | Kapitel 2 vollständig grün |

Abhängigkeiten in Kurzform: E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → (E9, E10) → E11 → E12 → E13 → E14 → E15 → E16 → E17 → Oberflächen E18 bis E23 → E24 → E25 → E26. Die Oberflächen dürfen früher beginnen, wenn eine Etappe blockiert ist (zum Beispiel durch eine offene Frage), weil ihre API dann schon steht.

---

## 6. Ergebnisse der Recherche vom 29.10.2026

### 6.1 Widerrufsbutton (§ 356a BGB) – Anforderungen für E17

Deutschland hat Art. 11a der Verbraucherrechte-Richtlinie (eingefügt durch Richtlinie (EU) 2023/2673) mit dem neuen **§ 356a BGB „Elektronische Widerrufsfunktion bei Fernabsatzverträgen“** umgesetzt (BGBl. 2026 I Nr. 28, in Kraft seit 19.06.2026). Daraus folgen diese Muss-Anforderungen:

| Nr. | Anforderung |
|---|---|
| W-01 | Im Footer jeder Seite steht ein hervorgehobener Knopf **„Vertrag widerrufen“**. Er ist optisch abgesetzt, ein unauffälliger Textlink reicht nicht. Er ist ohne Anmeldung erreichbar, weil Gäste bestellen können. |
| W-02 | Die Widerrufsseite fragt nur ab: Name, Angabe zur Bestellung (Bestellnummer, optional einzelne Positionen für einen Teilwiderruf) und E-Mail-Adresse für die Eingangsbestätigung. **Keine** Pflicht, einen Grund anzugeben. |
| W-03 | Zweiter Schritt: Zusammenfassung und Knopf **„Widerruf bestätigen“**. |
| W-04 | Die Erklärung wird sofort gespeichert (`orders.withdrawal`, Kanal `button`), auch wenn Bestellnummer und E-Mail nicht zusammenpassen. Maßgeblich für die Frist ist der Eingang (`received_at`). Passt die Angabe zu einer Bestellung, wird sie zugeordnet, sonst prüft der Händler von Hand. |
| W-05 | Unverzüglich geht eine **Eingangsbestätigung** per E-Mail raus: Inhalt der Erklärung, Datum und Uhrzeit des Eingangs. Formulierung „Wir haben Ihren Widerruf erhalten“, nicht „Ihr Widerruf wird bestätigt“ (die Prüfung folgt erst). |
| W-06 | Die Funktion ist dauerhaft verfügbar. Weil sich die individuelle Frist nicht für jeden Besucher bestimmen lässt, steht der Knopf immer im Footer. |
| W-07 | Schutz vor Missbrauch ohne Hürde für Kunden: Anfragebremse (wie Checkout), Prüffeld gegen CSRF, keine Auskunft auf der Seite, ob eine Bestellnummer existiert (gleiche Antwort in jedem Fall). |
| W-08 | Der Händler sieht Widerrufe in der Bestellung und in einer eigenen Liste, erhält eine Meldung und eine E-Mail. |
| W-09 | Produkte mit Ausschluss des Widerrufsrechts (`withdrawal_exclusion`, etwa Maßanfertigung) werden bei der Auswahl der Positionen gekennzeichnet, aber der Widerruf wird trotzdem angenommen und gespeichert. Die Entscheidung trifft der Händler. |

Das Datenmodell (`orders.withdrawal`) hat bereits alle nötigen Felder, es ist kein Umbau nötig.

### 6.2 Button-Lösung und Informationen vor der Bestellung (§ 312j BGB)

Unmittelbar vor dem Bestellknopf müssen wesentliche Merkmale, Gesamtpreis inklusive Steuern sowie Liefer- und Versandkosten klar sichtbar stehen. Der Knopf muss eindeutig auf die Zahlungspflicht hinweisen. „Zahlungspflichtig bestellen“ ist die sicherste Form und wird fest eingebaut. Diese Angaben stammen aus allgemeinem Wissen und wurden in der heutigen Recherche nicht gegen eine Quelle geprüft. Sie decken sich mit dem Featurekatalog.

### 6.3 Barrierefreiheit (BFSG)

- Maßstab in der Praxis ist die Norm EN 301 549, die auf **WCAG 2.1 AA** verweist. WCAG 2.2 AA ist nicht Pflicht, aber als „Wäre gut“ vorgesehen.
- **Neu:** Eine **Barrierefreiheitserklärung** ist nötig und kann im Footer verlinkt werden. Sie ist jetzt eine Pflichtseite (STR-05, EDI-02). Das Datenmodell kennt den Typ `accessibility_statement` bereits.
- Kleinstunternehmen (weniger als 10 Beschäftigte **und** höchstens 2 Mio. € Jahresumsatz) sind bei Dienstleistungen ausgenommen. Die Plattform baut trotzdem für alle Shops barrierefrei, weil das zum Lernziel gehört und die Plattform selbst die Technik stellt.

### 6.4 Nachgeschlagene Werte aus dem Sicherheitskonzept

| Punkt | Ergebnis |
|---|---|
| Argon2id | OWASP empfiehlt weiterhin mindestens 19 MiB Speicher, 2 Durchläufe, Parallelität 1. Bestätigt, keine Änderung. |
| pnpm `minimumReleaseAge` | Die Einstellung gibt es, die Einheit sind **Minuten**. Seit pnpm 11 ist der Standard 1 Tag (1440). Für 7 Tage wird `10080` eingetragen. Die aktuelle pnpm-Hauptversion ist wahrscheinlich 12, die genaue Version wird in E1 festgelegt. |

### 6.5 Sicherheitsmeldungen zu Better Auth

Die vollständige Liste auf GitHub war für die Recherche nicht erreichbar. Gefunden wurden unter anderem:

| Meldung | Inhalt | Folge für uns |
|---|---|---|
| CVE-2026-45337 | Fehler im Plugin für Geräte-Anmeldung, behoben in 1.6.11 | Plugin ist bei uns ohnehin aus. Mindestversion 1.6.11 |
| CVE-2026-45364 | Anfragebremse ließ sich durch wechselnde IPv6-Adressen umgehen | Eigene Bremse kürzt IPv6 auf `/64` (Q-15), Test dafür in T-18 |
| CVE-2025-71399 | Umgehung gesperrter Pfade und der Bremse durch andere Schreibweise des Pfads | Nur benötigte Pfade freigeben (Liste erlaubter statt gesperrter Pfade), Test mit Schreibvarianten |
| CVE-2025-61928 | Fehlende Rechteprüfung (bereits bekannt) | API-Key-Plugin von Better Auth bleibt aus, eigene API-Token |

Zusätzlich gab es Hinweise auf weitere Meldungen aus 2025 und 2026, deren Inhalt nicht geprüft werden konnte. Vor E6 wird die vollständige Liste von GitHub gelesen und die neueste Version fest eingetragen.

### Quellen

- Noerr, Umsetzungsgesetz zum Widerrufsbutton: https://www.noerr.com/de/insights/umsetzungsgesetz-zum-widerrufsbutton-veroeffentlicht
- IT-Recht Kanzlei, Button-Lösung und Widerrufsbutton: https://www.it-recht-kanzlei.de/button-loesung.html
- IHK Stuttgart, Barrierefreie Webseiten: https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/it-recht/barrierefreie-webseiten
- Händlerbund, GPSR-Umsetzung im Shop: https://ohn.haendlerbund.de/recht/rechtsfragen/gpsr-how-to-umsetzung-shop
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- pnpm-Einstellungen: https://pnpm.io/settings/dependency-resolution#minimumreleaseage
- Better Auth CVE-2026-45337: https://advisories.gitlab.com/npm/better-auth/CVE-2026-45337/
- Better Auth Meldungen (Übersicht): https://feed.craftedsignal.io/products/better-auth/

---

## 7. Entscheidungen von Kristof (29.10.2026)

| Frage | Antwort | Wirkung |
|---|---|---|
| Rechtstext-Vorlagen oder leere Seiten? | **Vorlagen** | Vorlagen mit Platzhaltern aus den Firmendaten, Hinweis „keine geprüften Rechtstexte“ (STR-05, E12) |
| Wann verfällt eine unbezahlte Bestellung? | **24 Stunden** | Hintergrundjob storniert und gibt Bestand frei, Wert ist eine Einstellung (ZAH-02, E15) |
| Bestand schon im Warenkorb reservieren? | **erst bei der Bestellung** | Warenkorb reserviert nichts, Hinweis bei Ausverkauf (WKC-01, LAG-01) |
| Kleinunternehmerregelung in Welle 1? | **später** | bleibt im Datenmodell vorbereitet (STR-01) |
| Stil des Standard-Designs? | **schlicht** | ruhiges, klares Design mit viel Weißraum (EDI-01, E22) |
| Testshops? | **Teeladen und Modeladen** | Beispieldaten für Tests und Vorführung (BET-02, E1) |

Es gibt keine offenen Fragen zu diesem Dokument.
