# Featurekatalog: Alle Funktionen der Shop-Plattform, priorisiert und auf Wellen verteilt

Stand: 27.10.2026. Zweck: Dieser Katalog sammelt jede Funktion, die unsere selbst gebaute Shop-Plattform irgendwann haben könnte, und legt fest, was wann gebaut wird. Die Plattform ist ein privates Lernexperiment, das Claude baut. Kein echter Händler und kein echter Kunde wird sie benutzen.

---

## 1. Einleitung

### 1.1 Quellen

Der Katalog beruht auf zwei Funktionslisten von ePages, einem deutschen Anbieter von Shop-Software:

- **ePages Now** (Feature list, März 2023, englisch): Das ist das klassische Shop-Produkt von ePages mit Produkttypen, Varianten, Kundengruppen, Staffelpreisen, vielen Zahlungsanbietern und rund 60 Partner-Apps.
- **ePages Store** (Feature list, April 2023, englisch): Das ist das neuere, einfachere Produkt von ePages. Es startet als Website und lässt sich per Schalter zum Shop erweitern. Es bringt zum Beispiel Massenaktionen, automatische Kategorien, Bestell-Timeline, Teilretouren und ein Dashboard mit.

Beide Listen wurden vollständig ausgewertet, zusammengeführt und von Dopplungen befreit. Funktionen, die in beiden Listen fehlen, die eine moderne Plattform aber braucht, sind ergänzt. Dazu gehören die Plattform-Verwaltung, KI-Funktionen, B2B, Sicherheit und deutsche Rechtspflichten wie Button-Lösung, Widerruf, Barrierefreiheit nach BFSG und E-Rechnung.

Die „Key benefits“ am Ende der Now-Liste sind keine eigenen Funktionen. Sie sind hier so abgedeckt: „Keine Programmierkenntnisse nötig“ und „Einfache Bedienung“ stecken im KI-Assistenten (KI-01) und im Editor (EDI-03), „Rechtskonform“ steckt im Bereich Steuern und Recht (STR), „Design-Beratung“ steht unter EDI-16 und „Automatische Updates“ unter BET-01. Die einzelnen Partner-Apps aus beiden Listen sind am Ende in Anhang A der jeweiligen Funktion zugeordnet.

**Disclaimer:** Die rechtlichen Punkte sind eine technische Anforderungsliste und keine Rechtsberatung. Fristen und Details zu neuen Pflichten (Widerrufsbutton, KI-Kennzeichnung, E-Rechnung) sind nach bestem Wissen angegeben und vor dem Bau der jeweiligen Funktion noch einmal zu prüfen.

### 1.2 Die drei Ebenen der Plattform

- **Plattform-Verwaltung:** Hier arbeitet der Betreiber der ganzen Plattform. Er legt Händler und Shops an und verwaltet Tarife.
- **Händler-Backoffice:** Hier arbeitet ein Händler in seinem eigenen Shop. Er pflegt Produkte, bearbeitet Bestellungen und gestaltet das Aussehen seines Shops mit dem visuellen Shop-Editor.
- **Storefront:** Das ist der Shop, den Kunden im Browser sehen und in dem sie einkaufen. Jeder Shop hat seine eigene Storefront.

### 1.3 Die Wellen

Eine Welle ist ein Bauabschnitt. Jede Welle endet mit einem funktionierenden Stand.

| Welle | Name | Inhalt |
|---|---|---|
| 1 | MVP (kleinstes funktionierendes Produkt) | Produkte anlegen, in den Warenkorb legen und kaufen. Nur Deutschland, nur Euro, nur Test-Zahlung. Dazu die Grundlagen von Plattform-Verwaltung, Sicherheit und deutschem Recht. |
| 2 | KI und Shop-Editor | Der KI-Assistent für Händler, der visuelle Editor und die Kernfunktionen, die nach dem MVP am dringendsten fehlen (Varianten, Rechnungen, Kundenkonto, Gutscheine, Suche). |
| 3 | B2B | Geschäftskunden: Firmenkonten, Kundengruppen, Staffelpreise, Nettopreise, Kauf auf Rechnung, E-Rechnung. |
| 4 | Partner-API, App-System und Internationalisierung | Webhooks, Apps von Dritten, mehrere Sprachen, Währungen und Länder. |
| 5 | Extras | Alles, was nett ist, aber nicht zum Kern gehört, zum Beispiel Marktplätze, Werbe-Integrationen und weitere Zahlungsanbieter. |

### 1.4 So liest man die Tabellen

Jede Zeile ist eine Funktion. Die Spalten bedeuten:

- **ID:** Eine eindeutige Kennung aus Bereichskürzel und Nummer, zum Beispiel PRD-01 für die erste Funktion im Bereich Produkte. Die Kürzel stehen jeweils in der Überschrift des Bereichs.
- **Feature:** Der Name der Funktion.
- **Erklärung:** Was die Funktion tut, in Alltagssprache.
- **Quelle:** „Now“ heißt, die Funktion steht nur in der Liste von ePages Now. „Store“ heißt, sie steht nur in der Liste von ePages Store. „beide“ heißt, sie steht in beiden Listen. „neu“ heißt, sie steht in keiner der Listen und wurde ergänzt.
- **Priorität:** „Muss“ heißt, ohne diese Funktion ist die Plattform unvollständig oder rechtlich angreifbar. „Wäre gut“ heißt, die Funktion bringt spürbaren Nutzen, ist aber verzichtbar. „Vielleicht später“ heißt, die Funktion wird nur gebaut, wenn Zeit und Lust bleiben.
- **Welle:** In welchem Bauabschnitt (1 bis 5) die Funktion entsteht.
- **Aufwand:** S bedeutet klein (Stunden bis ein Tag), M bedeutet mittel (einige Tage), L bedeutet groß (ein bis zwei Wochen), XL bedeutet besonders aufwendig (mehrere Wochen). Ein ⚠️ markiert Funktionen, die technisch sehr komplex oder fehleranfällig sind.
- **Neu gedacht:** Eine kurze Idee, wie die Funktion einfacher, besser oder KI-gestützt werden kann als bei den bestehenden Systemen. Ein Strich bedeutet, dass es hier nichts Sinnvolles neu zu denken gibt.

Eine Funktion mit der Priorität „Muss“ kann auch in einer späteren Welle liegen. „Muss“ beschreibt die Wichtigkeit für die fertige Plattform, die Welle beschreibt den Zeitpunkt. Alle Funktionen der Welle 1 haben die Priorität „Muss“.

---

## 2. Der Katalog

### 2.1 Plattform-Verwaltung (Kürzel PLA)

Diese Ebene fehlt in beiden ePages-Listen, weil die Listen sich an Händler richten. Für uns ist sie Pflicht, weil wir selbst der Plattformbetreiber sind.

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| PLA-01 | Plattform-Admin-Oberfläche | Der Betreiber hat eine eigene Verwaltungsoberfläche, in der er alle Händler und Shops sieht. | neu | Muss | 1 | M | Der Betreiber kann dieselben Aufgaben später auch per Chat erledigen, etwa mit der Frage, welche Shops seit einem Monat keine Bestellung hatten. |
| PLA-02 | Händler und Shops anlegen, sperren, löschen | Der Betreiber legt einen Händler und dessen Shop an, kann ihn vorübergehend sperren oder endgültig löschen. | neu | Muss | 1 | M | Ein neuer Shop startet mit fertigen Voreinstellungen (Deutschland, Euro, 19 Prozent Steuer, Test-Zahlung, Pauschalversand), sodass er sofort funktioniert. |
| PLA-03 | Mandantentrennung | Jeder Shop sieht technisch nur seine eigenen Daten. Das erzwingt die Datenbank selbst, auch wenn im Programmcode ein Fehler steckt. | neu | Muss | 1 | L | Die Trennung läuft über Row-Level-Security in PostgreSQL, also eine Regel direkt in der Datenbank, und wird mit automatischen Tests gegen Datenlecks geprüft. |
| PLA-04 | Händler-Login und Kontoeinstellungen | Der Händler meldet sich im Backoffice an und ändert seine E-Mail-Adresse, sein Passwort und seine persönlichen Daten. | Store | Muss | 1 | M | Später kommt die Anmeldung per Passkey hinzu, also per Fingerabdruck oder Gesichtserkennung statt Passwort. |
| PLA-05 | Kostenlose Subdomain pro Shop | Jeder Shop bekommt automatisch eine Adresse wie „meinshop.plattform.test“, die der Händler bei der Anmeldung wählt. | Store | Muss | 1 | S | – |
| PLA-06 | Plattform-Grundeinstellungen | Der Betreiber stellt zentral ein, über welchen Server E-Mails verschickt werden, wo Bilder gespeichert werden und welches KI-Modell genutzt wird. | neu | Muss | 1 | S | – |
| PLA-07 | Änderungsprotokoll (Audit-Log) | Jede wichtige Änderung wird mit Zeitpunkt und Urheber gespeichert, egal ob ein Mensch, die KI oder eine App sie ausgelöst hat. | neu | Muss | 1 | S | Das Protokoll ist die Grundlage dafür, dass man KI-Aktionen nachvollziehen und rückgängig machen kann. |
| PLA-08 | Support-Zugriff freigeben | Der Händler erlaubt dem Support, sich vorübergehend in sein Backoffice einzuloggen, um bei einem Problem zu helfen. | Store | Wäre gut | 5 | M | Der Zugriff ist zeitlich begrenzt, wird protokolliert und der Händler sieht jederzeit, ob er aktiv ist. |
| PLA-09 | Mitarbeiter und Rollen im Händler-Team | Ein Händler lädt Mitarbeiter ein und legt fest, was sie dürfen, zum Beispiel nur Bestellungen bearbeiten. | neu | Wäre gut | 5 | M | Rollen werden in Alltagssprache beschrieben, etwa „darf Bestellungen sehen, aber keine Preise ändern“, und die KI übersetzt das in Rechte. |
| PLA-10 | Tarife mit Funktionsschaltern | Der Betreiber definiert Tarife mit Grenzen (zum Beispiel Anzahl Produkte) und schaltet Funktionen pro Tarif frei. Das entspricht den Paketen S, M, L und XL bei ePages. | neu | Wäre gut | 5 | M | Jede Funktion ist von Anfang an über einen Schalter steuerbar, sodass ein Tarif nur eine Liste von Schaltern ist. |
| PLA-11 | Website-Paket und Schalter für den Verkauf | Ein Shop kann als reine Website ohne Kasse starten und den Verkauf später per Schalter einschalten. | Store | Vielleicht später | 5 | M | Das wird kein eigenes Produkt, sondern nur ein Funktionsschalter im Tarif (siehe PLA-10). |
| PLA-12 | Eigene Domain verbinden | Der Händler verbindet eine eigene Domain wie „mein-laden.de“ mit seinem Shop. | beide | Wäre gut | 5 | L | Das Sicherheitszertifikat für die Domain wird automatisch und kostenlos über Let's Encrypt erstellt und erneuert. |
| PLA-13 | Domain direkt registrieren | Der Händler kauft eine neue Domain direkt in der Plattform. | beide | Vielleicht später | 5 | L | Dafür braucht man einen kostenpflichtigen Domain-Anbieter, deshalb ist die Funktion für das Lernprojekt nachrangig. |
| PLA-14 | Selbstregistrierung von Händlern | Ein neuer Händler meldet sich selbst an, ohne dass der Betreiber ihn anlegen muss. | neu | Wäre gut | 2 | M | Der Händler beschreibt sein Geschäft in zwei, drei Sätzen und die KI richtet daraus den Shop ein (siehe KI-08). |
| PLA-15 | Plattform-Dashboard | Der Betreiber sieht Kennzahlen über alle Shops, etwa Anzahl Shops, Bestellungen und Speicherverbrauch. | neu | Wäre gut | 5 | M | – |
| PLA-16 | Abrechnung der Tarife an Händler | Die Plattform stellt den Händlern ihre monatliche Gebühr in Rechnung. | neu | Vielleicht später | 5 | L | Für ein Lernprojekt ohne echte Händler reicht eine simulierte Abrechnung. |

### 2.2 Betrieb und Hosting (Kürzel BET)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| BET-01 | Automatische Updates | Neue Versionen der Software werden eingespielt, ohne dass ein Händler etwas tun muss. Datenbank-Änderungen laufen dabei automatisch mit. | beide | Muss | 1 | M | Jede Änderung läuft durch automatische Tests, bevor sie live geht. |
| BET-02 | Selbst betreibbar mit einem Befehl | Die ganze Plattform startet auf einem eigenen Server mit einem einzigen Befehl. Es werden nur freie Open-Source-Bausteine genutzt. | neu | Muss | 1 | M | Ein Docker-Compose-Paket enthält Datenbank, Bildspeicher, Mail-Testserver und Anwendung. |
| BET-03 | Datensicherung und Wiederherstellung | Die Datenbank und die Bilder werden regelmäßig gesichert und lassen sich wiederherstellen. | neu | Muss | 1 | S | Die Wiederherstellung wird regelmäßig automatisch getestet, weil eine ungetestete Sicherung wertlos ist. |
| BET-04 | Dateispeicher für Bilder und Dokumente | Bilder und PDF-Dateien liegen in einem eigenen Speicher, der wie Amazon S3 funktioniert, aber selbst betrieben wird. | neu | Muss | 1 | S | Als Speicher dient eine Open-Source-Lösung wie MinIO oder Garage. |
| BET-05 | Hintergrundaufgaben | Langsame Arbeiten wie E-Mail-Versand oder Bildverkleinerung laufen im Hintergrund, damit der Shop schnell bleibt. | neu | Muss | 1 | M | Die Warteschlange liegt direkt in PostgreSQL, sodass kein zusätzlicher Dienst nötig ist. |
| BET-06 | Überwachung und Fehlerprotokolle | Die Plattform meldet Fehler und Ausfälle und zeigt, wie schnell sie antwortet. | neu | Wäre gut | 2 | M | – |
| BET-07 | Schnelle Auslieferung der Storefront | Shopseiten werden zwischengespeichert, damit sie auch bei vielen Besuchern sofort laden. | neu | Wäre gut | 2 | M | Seiten werden nur dann neu erzeugt, wenn sich ihre Inhalte tatsächlich geändert haben. |

### 2.3 Backoffice-Grundlagen und Einstellungen (Kürzel EIN)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| EIN-01 | Allgemeine Einstellungen | Der Händler trägt Firmendaten, Shopnamen, Adresse und rechtliche Angaben ein. | beide | Muss | 1 | S | Später liest die KI diese Daten aus einem Foto der Visitenkarte oder aus der bisherigen Website aus. |
| EIN-02 | Shop online oder offline schalten | Der Händler entscheidet, ob sein Shop für Besucher sichtbar ist oder eine Wartungsseite zeigt. | beide | Muss | 1 | S | – |
| EIN-03 | Dashboard | Die Startseite des Backoffice zeigt Kennzahlen, offene Aufgaben (zum Beispiel unbearbeitete Bestellungen), den Shop-Status, Hilfe-Links und die letzten Änderungen. | Store | Muss | 2 | M | Das Dashboard schlägt die nächsten sinnvollen Schritte vor, etwa „Drei Produkte haben noch kein Bild“. |
| EIN-04 | Checkout-Einstellungen | Der Händler legt fest, welche Adressfelder Pflicht sind, welche eigenen Hinweistexte im Checkout stehen und ob die AGB per Häkchen oder per Hinweis bestätigt werden. | beide | Wäre gut | 2 | S | – |
| EIN-05 | E-Mail-Vorlagen verwalten | Der Händler passt Texte und Aussehen aller automatischen E-Mails an, sowohl an Kunden als auch an sich selbst. | beide | Wäre gut | 2 | M | Die KI formuliert die Texte im Ton des Shops um, die rechtlichen Pflichtbausteine bleiben dabei fest. |
| EIN-06 | Massen-Import und -Export | Produkte, Varianten, Kategorien, Kundendaten, Produkttypen, Cross-Selling und Kategoriezuordnungen lassen sich als Tabelle (CSV oder XLSX) ein- und auslesen. | beide | Wäre gut | 2 | M | Der Händler lädt eine beliebige Tabelle hoch und die KI ordnet die Spalten selbst zu, statt dass er eine feste Vorlage ausfüllen muss. |
| EIN-07 | Standorte verwalten | Der Händler pflegt seine Ladengeschäfte mit Adresse und Öffnungszeiten, zeigt sie im Footer an und verbindet sie mit seinem Google-Unternehmensprofil. | Store | Vielleicht später | 5 | M | Die Öffnungszeiten werden auch als strukturierte Daten für Suchmaschinen ausgegeben. |

### 2.4 Storefront-Design und Shop-Editor (Kürzel EDI)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| EDI-01 | Responsives Standard-Design | Der Shop hat ein modernes Design, das sich automatisch an Handy, Tablet und Computer anpasst. | beide | Muss | 1 | M | Das Design ist von Anfang an barrierefrei und schnell und wird zuerst für das Handy gebaut. |
| EDI-02 | Footer mit Pflichtseiten | Im unteren Bereich jeder Seite stehen automatisch alle rechtlich nötigen Seiten. Pflichtseiten stehen zuerst, eigene Einträge wie „Über uns“ kann der Händler ergänzen und sortieren. | beide | Muss | 1 | S | Die Pflichtseiten kann der Händler nicht versehentlich entfernen. |
| EDI-03 | Visueller Live-Editor | Der Händler gestaltet seinen Shop direkt in einer Vorschau und sieht jede Änderung sofort (WYSIWYG, „what you see is what you get“). | beide | Muss | 2 | XL ⚠️ | Seiten bestehen aus Abschnitten und Bausteinen, die als Daten gespeichert werden. Der Händler kann jeden Abschnitt auch per KI-Widget beschreiben lassen (siehe KI-07). |
| EDI-04 | Design-Vorlagen wechseln | Der Händler wählt zwischen mehreren kostenlosen Designs und kann jederzeit wechseln, ohne Inhalte zu verlieren. | beide | Muss | 2 | L | Weil Inhalt und Design strikt getrennt gespeichert sind, ist ein Wechsel gefahrlos und jederzeit umkehrbar. |
| EDI-05 | Entwürfe, Versionen und Rückgängig | Änderungen am Design sind erst ein Entwurf und werden mit einem Klick veröffentlicht. Jede frühere Version lässt sich wiederherstellen. | neu | Muss | 2 | M | Die KI darf nur Entwürfe erzeugen, veröffentlicht wird immer erst nach Bestätigung durch den Händler. |
| EDI-06 | Vorschau für Handy, Tablet und Computer | Der Händler schaltet im Editor zwischen den Ansichten für verschiedene Geräte um. | Store | Muss | 2 | S | – |
| EDI-07 | Logo-Editor | Der Händler lädt ein Logo hoch, schneidet es zu, platziert es im Kopfbereich oder zeigt nur den Shopnamen an. | beide | Muss | 2 | M | Die KI erstellt aus einem Handyfoto des Logos eine saubere, freigestellte Version. |
| EDI-08 | Favicon | Der Händler legt das kleine Symbol im Browser-Tab fest. Es dient auch als Symbol, wenn Kunden den Shop auf dem Handy als Lesezeichen speichern. | beide | Wäre gut | 2 | S | Das Favicon wird automatisch aus dem Logo erzeugt. |
| EDI-09 | Schriftarten | Der Händler wählt aus einer Auswahl von Schriften. | Store | Muss | 2 | S | Es werden nur selbst gehostete, freie Schriften verwendet, damit keine Daten an Dritte wie Google gehen. |
| EDI-10 | Farben für Text, Hintergründe und Knöpfe | Der Händler legt Farben fest, hebt Textstellen farbig hervor und färbt Hintergründe von Bereichen ein. | beide | Muss | 2 | M | Die Plattform schlägt eine Farbpalette passend zum Logo vor und prüft automatisch, ob Text gut lesbar ist. |
| EDI-11 | Kopfbereich-Varianten | Der Händler wählt aus vorbereiteten Varianten für den Kopfbereich (Header) seines Shops. | beide | Wäre gut | 2 | M | – |
| EDI-12 | Vorteile im Kopfbereich (USPs) | Der Händler zeigt bis zu fünf Vorteile wie „Versand in 24 Stunden“ mit passendem Symbol oben im Shop an. | beide | Wäre gut | 2 | S | Die KI schlägt Vorteile vor, die sich aus den Shop-Einstellungen ergeben, etwa die Versandfreigrenze. |
| EDI-13 | Zahlungs- und Versandlogos im Footer | Logos der angebotenen Zahlungsarten und Versanddienstleister schaffen Vertrauen. Eigene Logos lassen sich ergänzen. | beide | Wäre gut | 2 | S | Die Logos erscheinen automatisch, sobald eine Zahl- oder Versandart aktiviert ist. |
| EDI-14 | Social-Media-Symbole | Symbole für Facebook, Instagram, Pinterest, X (Twitter) und YouTube verlinken auf die Profile des Händlers. | beide | Wäre gut | 2 | S | – |
| EDI-15 | Barrierefreiheits-Prüfung im Editor | Der Editor warnt, wenn etwas schlecht zugänglich ist, etwa ein Bild ohne Beschreibung oder zu wenig Kontrast. | neu | Muss | 2 | M | Die KI schreibt fehlende Bildbeschreibungen (Alternativtexte) automatisch. |
| EDI-16 | Design-Service durch Experten | Ein Designer passt den Shop gegen Bezahlung individuell an. | beide | Vielleicht später | 5 | S | Ein KI-Designberater ersetzt den bezahlten Service, indem er Verbesserungen vorschlägt und auf Wunsch umsetzt. |
| EDI-17 | Eigenes CSS | Fortgeschrittene Händler ändern das Aussehen mit eigenem Gestaltungscode (CSS). | beide | Vielleicht später | 5 | S | Lieber Design-Einstellungen anbieten, weil eigenes CSS bei Design-Updates leicht kaputtgeht. |
| EDI-18 | Eigenes HTML und iFrames | Fortgeschrittene Händler fügen eigenen HTML-Code oder eingebettete fremde Seiten ein. | beide | Vielleicht später | 5 | M | Fremder Code läuft nur in einem abgeschotteten Rahmen, damit er keine Kundendaten abgreifen kann. |

### 2.5 Inhaltsseiten und Inhaltselemente (Kürzel INH)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| INH-01 | Einfache Textseiten | Der Händler legt Seiten mit Überschrift und Text an, zum Beispiel für Impressum, AGB oder „Über uns“. | beide | Muss | 1 | S | Auch einfache Textseiten werden schon im Baustein-Format gespeichert, damit der Editor sie später ohne Umbau bearbeiten kann. |
| INH-02 | Seiten aus Bausteinen zusammenbauen | Der Händler setzt Seiten aus fertigen Inhaltselementen (Text, Bild, Produkte, Formular) per Drag-and-drop zusammen. | beide | Muss | 2 | L | Der Händler sagt „Füge unter dem Titelbild drei Bestseller ein“ und die KI setzt den passenden Baustein ein. |
| INH-03 | Menü sortieren | Der Händler ordnet Seiten und Kategorien im Hauptmenü per Drag-and-drop. | beide | Muss | 2 | S | – |
| INH-04 | Seiten duplizieren | Eine vorhandene Seite dient als Vorlage für eine neue Seite. | beide | Wäre gut | 2 | S | – |
| INH-05 | Knöpfe im Text | Der Händler setzt im Text einen Knopf, der zum Beispiel zu einem Produkt führt (Call-to-Action). | Now | Wäre gut | 2 | S | – |
| INH-06 | Produkt-Slider | Ein Baustein zeigt ausgewählte Produkte zum Durchblättern an, wahlweise mit großen oder kleinen Bildern. | beide | Wäre gut | 2 | M | Der Slider kann sich auch automatisch füllen, etwa mit den Bestsellern oder den neuesten Produkten. |
| INH-07 | Kategorie-Baustein | Eine Produktkategorie lässt sich auf jeder beliebigen Seite anzeigen. | Store | Wäre gut | 2 | S | – |
| INH-08 | Bildergalerie | Eine Galerie mit bis zu 24 Bildern per Massen-Upload, auch als Lookbook mit Links zu Produkten. | beide | Wäre gut | 2 | M | Die Galerie ersetzt die Apps „POWr gallery“ und „POWr Media Gallery“. |
| INH-09 | Bilder mit Text und Knopf | Auf ein Bild lassen sich Überschrift, Text und ein anklickbarer Knopf legen. Die Farben folgen dem gewählten Design. | beide | Wäre gut | 2 | S | – |
| INH-10 | FAQ-Liste zum Aufklappen | Ein Baustein zeigt häufige Fragen, deren Antworten sich per Klick aufklappen. | beide | Wäre gut | 2 | S | Die KI schlägt Fragen und Antworten aus den Shop-Einstellungen (Versand, Zahlung, Rückgabe) vor. |
| INH-11 | Kontaktformular mit Spamschutz | Besucher schreiben dem Händler über ein Formular, auch kombiniert mit Text oder Karte. | beide | Wäre gut | 2 | M | Der Spamschutz kommt ohne Google reCAPTCHA aus und nutzt eine freie, datenschutzfreundliche Lösung. |
| INH-12 | Videos einbetten | YouTube-Videos lassen sich auf Seiten einbinden. | beide | Wäre gut | 2 | S | Das Video lädt erst nach Zustimmung des Besuchers, damit vorher keine Daten an YouTube fließen. |
| INH-13 | Karte einbetten | Eine Karte zeigt den Standort des Ladens. | beide | Vielleicht später | 5 | S | Statt Google Maps wird OpenStreetMap genutzt, das frei und datenschutzfreundlicher ist. |
| INH-14 | Google Tag Manager und Tracking-Code | Fortgeschrittene Händler binden Tracking- und Werbe-Codes (zum Beispiel ein Facebook-Pixel) ein. | beide | Vielleicht später | 5 | S | Codes laufen nur nach Einwilligung. Als Alternative bietet die Plattform eine eigene datenschutzfreundliche Statistik an. |
| INH-15 | Formular-Baukasten | Der Händler baut eigene Formulare, etwa für Anfragen oder Gewinnspiele. | beide | Wäre gut | 5 | M | Die KI baut das Formular aus einer Beschreibung wie „Anfrage für Hochzeitstorten mit Datum und Personenzahl“. |
| INH-16 | Social-Media-Feed | Aktuelle Beiträge aus den Social-Media-Konten erscheinen automatisch im Shop. | beide | Vielleicht später | 5 | M | – |
| INH-17 | Terminbuchung | Kunden buchen direkt im Shop einen Termin, etwa für eine Beratung im Laden. | beide | Vielleicht später | 5 | L | – |

### 2.6 Storefront aus Kundensicht (Kürzel STF)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| STF-01 | Grundgerüst der Storefront | Der Shop hat eine Startseite, Kategorieseiten, Produktseiten, einen Warenkorb und einen Checkout. | beide | Muss | 1 | M | Die Storefront holt alle Daten über dieselbe öffentliche Schnittstelle (API), die auch fremde Frontends nutzen könnten. |
| STF-02 | Produktdarstellung | Produkte erscheinen in Listen und auf einer eigenen Seite mit Bildern, Beschreibung, Merkmalen, Preis und allen Pflichtangaben. | beide | Muss | 1 | M | – |
| STF-03 | Produkt-Zoom | Kunden vergrößern Produktbilder per Maus oder durch Antippen und Halten auf dem Handy. | beide | Wäre gut | 2 | S | – |
| STF-04 | Produktsuche | Ein Suchfeld findet Produkte, deren Name oder Beschreibung den Suchbegriff enthält. | beide | Muss | 2 | M | Die eingebaute Volltextsuche von PostgreSQL reicht aus, sodass keine eigene Suchmaschine nötig ist. |
| STF-05 | Suchvorschläge | Schon beim Tippen erscheinen passende Produkte als Vorschläge. | beide | Wäre gut | 2 | M | – |
| STF-06 | „Mehr anzeigen“ und „Nach oben“ | Statt Seitenzahlen lädt ein Knopf weitere Produkte nach. Ein zweiter Knopf springt zurück nach oben. | beide | Wäre gut | 2 | S | – |
| STF-07 | Sortieren von Produktlisten | Kunden sortieren nach Preis, Empfehlung, Neuheit, Angeboten oder Verfügbarkeit. | beide | Wäre gut | 2 | S | – |
| STF-08 | Sortieren von Suchergebnissen | Kunden sortieren Suchergebnisse nach Relevanz oder Preis. | beide | Wäre gut | 2 | S | – |
| STF-09 | Suchfilter | Kunden grenzen Ergebnisse nach Kategorie, Hersteller, Preisspanne oder Merkmalen wie Farbe und Größe ein. | Now | Wäre gut | 2 | L | Filter ergeben sich automatisch aus den Produktmerkmalen, der Händler muss sie nicht einzeln anlegen. |
| STF-10 | Kundenkonto | Kunden legen ein Konto an, sehen ihre Bestellungen, verwalten Rechnungs- und Lieferadressen, ändern ihre Daten und können das Konto löschen. | beide | Muss | 2 | M | Die Anmeldung klappt auch ohne Passwort, über einen Link per E-Mail oder einen Passkey. |
| STF-11 | Wunschliste | Kunden merken sich Produkte und verschieben sie später in den Warenkorb. | Now | Wäre gut | 5 | M | – |

### 2.7 Produkte (Kürzel PRD)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| PRD-01 | Produkte anlegen | Der Händler legt beliebig viele Produkte mit Name, Beschreibung, Bild, Preis und Artikelnummer an. | beide | Muss | 1 | M | Ab Welle 2 reicht ein Foto und die KI schreibt einen vollständigen Entwurf (siehe KI-04). |
| PRD-02 | Produkt bearbeiten | Jedes Produkt hat im Backoffice eine eigene Seite, auf der alle Angaben gepflegt werden. | beide | Muss | 1 | M | – |
| PRD-03 | Produktübersicht | Eine Liste zeigt alle Produkte mit Nummer, Name, Preis, Bestand und Sichtbarkeit. Name, Preis und Bestand lassen sich direkt in der Liste ändern. | beide | Muss | 1 | M | – |
| PRD-04 | Entwurf oder veröffentlicht | Ein Produkt ist entweder ein Entwurf (im Shop unsichtbar) oder veröffentlicht. | Store | Muss | 1 | S | – |
| PRD-05 | Produktbilder | Mehrere Bilder pro Produkt werden automatisch in passende Größen für jedes Gerät umgerechnet. | beide | Muss | 1 | M | Bilder werden automatisch in moderne, kleine Formate (WebP, AVIF) umgewandelt. |
| PRD-06 | Produkt duplizieren | Ein vorhandenes Produkt dient als Vorlage für ein neues. | Store | Wäre gut | 2 | S | – |
| PRD-07 | Suche und Filter im Backoffice | Der Händler findet Produkte nach Nummer, Name, Beschreibung, Produkttyp, Bestand, Sichtbarkeit, Angebot, Hersteller oder Schlagwort. Schnellfilter zeigen etwa „fast ausverkauft“. | beide | Wäre gut | 2 | M | Der Händler sucht in Alltagssprache, etwa „alle roten Shirts unter 20 Euro ohne Bild“. |
| PRD-08 | Massenaktionen | Mehrere Produkte auf einmal veröffentlichen, löschen, auf Entwurf setzen, mit Schlagworten versehen oder Kategorien zuordnen. | Store | Wäre gut | 2 | M | Per Chat geht das mit einem Satz wie „Setze alle Winterjacken auf Entwurf“. |
| PRD-09 | Produkttypen | Vorlagen für ähnliche Produkte mit gemeinsamen Merkmalen, zum Beispiel „T-Shirt“ mit Größe und Farbe. Sie sind die Grundlage für Varianten. | Now | Muss | 2 | M | Die KI erkennt beim Anlegen, welcher Produkttyp passt, und legt fehlende Typen selbst an. |
| PRD-10 | Produktmerkmale | Zusätzliche Angaben wie Größe, Farbe oder Material mit bis zu 20 Werten pro Merkmal. | Now | Muss | 2 | M | – |
| PRD-11 | Varianten | Ein Produkt hat Ausführungen, etwa in drei Größen und vier Farben, jeweils mit eigenem Preis, Bild, Bestand und Text. ePages erlaubt bis zu 250 (Now) beziehungsweise 150 (Store) Varianten mit bis zu drei Merkmalen. | beide | Muss | 2 | L | Im Datenmodell hat ab Welle 1 jedes Produkt mindestens eine Variante, sodass später nichts umgebaut werden muss. |
| PRD-12 | Bilder zuschneiden und drehen | Der Händler bearbeitet Produktbilder direkt im Backoffice. | beide | Wäre gut | 2 | M | Die KI stellt das Produkt frei und setzt einen einheitlichen Hintergrund (siehe KI-06). |
| PRD-13 | Tabellen in Beschreibungen | Im Beschreibungstext lassen sich Tabellen anlegen, etwa für Maße oder Nährwerte. | Store | Wäre gut | 2 | S | – |
| PRD-14 | Label „Neu“ | Neue Produkte bekommen ein sichtbares Etikett auf dem Bild. | Store | Wäre gut | 2 | S | Das Etikett erscheint automatisch eine einstellbare Zeit nach dem Anlegen und verschwindet dann von selbst. |
| PRD-15 | Cross-Selling | Auf der Produktseite erscheinen passende Zusatzprodukte. | beide | Wäre gut | 2 | M | Die KI schlägt passende Produkte vor, anfangs aus den Produktdaten, später aus echten Bestellungen. |
| PRD-16 | Produktcodes und Hersteller | Der Händler pflegt EAN, UPC oder ISBN sowie Hersteller oder Marke. | Now | Wäre gut | 2 | S | – |
| PRD-17 | Versandgewicht | Jedes Produkt hat ein Gewicht, das im Shop angezeigt und für Versandkosten genutzt werden kann. | Store | Wäre gut | 2 | S | – |
| PRD-18 | Produktvideos | Videos von YouTube oder Vimeo erscheinen auf der Produktseite. | Store | Wäre gut | 5 | S | – |
| PRD-19 | Dokumente am Produkt | Ein PDF oder Bild, etwa ein Datenblatt, hängt am Produkt und kann heruntergeladen werden. | Store | Wäre gut | 5 | S | – |
| PRD-20 | Personalisierbare Produkte | Kunden geben einen eigenen Text ein, etwa für eine Gravur. Der Händler legt die maximale Länge fest. | beide | Wäre gut | 5 | M | – |
| PRD-21 | Digitale Produkte | Kunden kaufen Dateien wie E-Books und bekommen nach der Zahlung einen Download-Link. | Now | Vielleicht später | 5 | M | – |

### 2.8 Preise (Kürzel PRS)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| PRS-01 | Preis mit Steuerklasse | Jedes Produkt hat einen Preis und eine Steuerklasse (zum Beispiel „normal“ oder „ermäßigt“). | beide | Muss | 1 | M | Preise stehen schon in Welle 1 in einer eigenen Preistabelle mit Währung, Verkaufskanal und Kundengruppe, auch wenn es anfangs nur Euro und Endkunden gibt. |
| PRS-02 | Angebotspreis mit Streichpreis | Ein reduzierter Preis wird zusammen mit dem durchgestrichenen ursprünglichen Preis angezeigt. | beide | Wäre gut | 2 | S | Die Plattform speichert jeden Preis mit Datum und zeigt automatisch den gesetzlich nötigen 30-Tage-Tiefstpreis (siehe STR-12). |
| PRS-03 | Streichpreis als UVP kennzeichnen | Der Händler legt fest, ob der Streichpreis als unverbindliche Preisempfehlung des Herstellers gilt. | Now | Wäre gut | 2 | S | – |
| PRS-04 | Staffelpreise | Wer mehr Stück kauft, zahlt pro Stück weniger. | Now | Muss | 3 | M | – |
| PRS-05 | Kundengruppenpreise | Bestimmte Kundengruppen bekommen eigene Preise und Rabatte. | Now | Muss | 3 | M | – |
| PRS-06 | Zeitgesteuerte Preise | Ein Preis gilt nur in einem bestimmten Zeitraum, etwa während einer Aktionswoche. | neu | Wäre gut | 5 | S | – |

### 2.9 Kategorien (Kürzel KAT)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| KAT-01 | Kategorien anlegen und Produkte zuordnen | Der Händler legt Kategorien wie „Tee“ oder „Zubehör“ an und ordnet Produkte zu. Kategorien erscheinen im Menü. | beide | Muss | 1 | S | – |
| KAT-02 | Unterkategorien und Kategorieseiten | Kategorien lassen sich verschachteln (zum Beispiel „Tee“ und darunter „Grüner Tee“) und per Drag-and-drop sortieren. | Now | Muss | 2 | M | Das Datenmodell erlaubt Verschachtelung schon in Welle 1. |
| KAT-03 | Automatische Kategorien | Kategorien füllen sich selbst nach Regeln, etwa nach Schlagwort, Preis oder Hersteller, auch mit neuen Produkten. | Store | Wäre gut | 2 | M | Der Händler beschreibt die Regel in Alltagssprache, etwa „alles unter 20 Euro von Marke X“. |
| KAT-04 | Schlagworte (Smart Tagging) | Produkte bekommen Schlagworte, nach denen sie gefiltert und in Kategorien einsortiert werden. | Store | Wäre gut | 2 | S | Die KI vergibt Schlagworte beim Anlegen automatisch. |

### 2.10 Warenkorb und Checkout (Kürzel WKC)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| WKC-01 | Warenkorb | Kunden legen Produkte in den Warenkorb, ändern die Menge und entfernen Produkte. | beide | Muss | 1 | M | – |
| WKC-02 | Sicherer, rechtskonformer Checkout | Kunden geben Adresse ein, wählen Versand- und Zahlungsart, prüfen alles auf einer Übersicht und bestellen. | beide | Muss | 1 | L | Der Checkout besteht aus einer einzigen, übersichtlichen Seite statt aus vielen Schritten. |
| WKC-03 | Bestellung als Gast | Kunden bestellen ohne Kundenkonto. | Now | Muss | 1 | S | Nach der Bestellung kann der Gast mit einem Klick ein Konto anlegen, ohne Daten erneut einzugeben. |
| WKC-04 | Dauerhafter Warenkorb | Der Warenkorb bleibt gespeichert, wenn der Kunde später wiederkommt. | Now | Wäre gut | 2 | S | – |
| WKC-05 | Mindestbestellwert | Eine Bestellung ist erst ab einem bestimmten Betrag möglich. Kunden sehen im Checkout einen Hinweis. | beide | Wäre gut | 3 | S | Der Mindestbestellwert kann pro Kundengruppe unterschiedlich sein, was für B2B wichtig ist. |
| WKC-06 | Warenkorbrabatt für bestimmte Kunden | Nur angemeldete oder ausgewählte Kunden bekommen einen Rabatt auf den ganzen Warenkorb. | Now | Wäre gut | 3 | M | – |
| WKC-07 | Express-Checkout | Kunden zahlen direkt aus dem Warenkorb mit Apple Pay, Google Pay oder PayPal, ohne Adresse einzutippen. | neu | Vielleicht später | 5 | M | – |
| WKC-08 | Erinnerung an abgebrochene Warenkörbe | Kunden, die den Kauf abgebrochen haben, bekommen eine Erinnerungs-E-Mail. | neu | Vielleicht später | 5 | M | Die Erinnerung geht nur an Kunden, die dem ausdrücklich zugestimmt haben. |

### 2.11 Bestellungen (Kürzel BST)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| BST-01 | Bestellübersicht | Eine Liste zeigt alle Bestellungen mit Zahlungs- und Versandstatus. | beide | Muss | 1 | M | – |
| BST-02 | Bestelldetails mit Verlauf | Jede Bestellung hat eine Detailseite mit allen Angaben und einer Zeitleiste aller Ereignisse. | beide | Muss | 1 | M | Die Bestellung speichert eine unveränderliche Kopie von Preisen, Steuern und Rechtstexten zum Zeitpunkt des Kaufs. |
| BST-03 | Status ändern | Der Händler markiert eine Bestellung als bezahlt, versendet oder zugestellt. | Store | Muss | 1 | S | Zahlungs-, Versand- und Bestellstatus sind getrennte Felder, damit Teillieferungen später möglich sind. |
| BST-04 | Benachrichtigung bei neuer Bestellung | Der Händler bekommt bei jeder neuen Bestellung eine Meldung im Backoffice und per E-Mail. Unbearbeitete Bestellungen sind hervorgehoben. | Store | Muss | 1 | S | – |
| BST-05 | Bestellbestätigung per E-Mail | Kunden bekommen nach der Bestellung automatisch eine Bestätigung mit allen Pflichtangaben. Später folgt auch eine Versandbestätigung. | beide | Muss | 1 | M | – |
| BST-06 | Stornierung, Retoure und Erstattung | Der Händler storniert, nimmt zurück oder erstattet, auch nur teilweise. Der Bestand wird dabei automatisch korrigiert. | Store | Muss | 2 | L | Der Händler sagt „Frau Müller schickt das blaue Shirt zurück“ und die KI bereitet Retoure, Erstattung und Gutschrift zur Bestätigung vor. |
| BST-07 | Abgleich mit Zahlung und Versand | Zahlungseingänge und Versandmeldungen von Dienstleistern aktualisieren die Bestellung automatisch. | Store | Muss | 2 | L | – |
| BST-08 | Bestelldokumente | Rechnung, Lieferschein, Gutschrift, Stornorechnung und Korrekturrechnung entstehen als PDF und werden per E-Mail verschickt. | beide | Muss | 2 | L | – |
| BST-09 | Dokumente gestalten | Der Händler ergänzt Logo, Firmendaten sowie Texte im Haupt- und Fußteil der Dokumente. | Store | Wäre gut | 2 | S | – |
| BST-10 | Bestellsuche und Filter | Der Händler sucht nach Zahlart, Versandart, Zeitraum, Bestell-, Rechnungs- oder Artikelnummer, Kundenname, Status oder Marketing-Kampagne. Häufige Kombinationen gibt es als Schnellfilter. | beide | Wäre gut | 2 | M | Die Suche versteht Alltagssprache, etwa „unbezahlte Bestellungen von letzter Woche“. |
| BST-11 | Massenaktionen für Bestellungen | Mehrere Bestellungen auf einmal als gesehen oder ungesehen markieren oder Rechnungen und Lieferscheine erzeugen. | Store | Wäre gut | 2 | M | – |
| BST-12 | Bestellungen exportieren | Ausgewählte Bestellungen werden als Datei gespeichert, etwa für die Steuererklärung. | Store | Wäre gut | 2 | S | – |
| BST-13 | Bestellung manuell anlegen | Der Händler legt eine Bestellung selbst an, etwa nach einem Telefonanruf, für registrierte und nicht registrierte Kunden. | Now | Wäre gut | 3 | M | Per Chat reicht ein Satz wie „Lege für Firma Schmidt 20 Stück von Artikel 4711 an“. |
| BST-14 | Bestellübersicht je Zahlungsanbieter | Eine eigene Liste zeigt nur die Bestellungen eines Zahlungsanbieters, zum Beispiel PayPal. | Now | Vielleicht später | 5 | S | Das ist nur ein gespeicherter Filter der normalen Bestellübersicht, keine eigene Seite. |

### 2.12 Kunden (Kürzel KND)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| KND-01 | Kundenübersicht | Eine Liste zeigt registrierte Kunden und Gastkunden mit Name, Ort, Status und Bestellhistorie. | beide | Muss | 2 | M | – |
| KND-02 | Kundendetails | Eine Seite zeigt alle Daten eines Kunden, seine Adressen, Bestellungen und eine Zeitleiste. Der Händler kann den Kunden bearbeiten oder löschen. | Store | Muss | 2 | M | – |
| KND-03 | Kunden suchen und sortieren | Der Händler sucht nach Name, Kundennummer, E-Mail, Adresse oder Bestelldaten und sortiert nach Umsatz oder letzter Bestellung. | beide | Wäre gut | 2 | S | – |
| KND-04 | Kunden manuell anlegen | Der Händler legt Kunden selbst an. | beide | Wäre gut | 2 | S | – |
| KND-05 | Kundengruppen | Der Händler teilt Kunden in Gruppen ein, etwa „Stammkunden“ oder „Händler“, um ihnen eigene Preise und Rabatte zu geben. | Now | Muss | 3 | M | Das Datenmodell kennt ab Welle 1 eine Standardgruppe „Endkunden“, der jeder Kunde angehört. |

### 2.13 Zahlung (Kürzel ZAH)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| ZAH-01 | Test-Zahlung | Eine simulierte Zahlungsart, mit der man den Kauf vollständig durchspielen kann, ohne dass Geld fließt. | neu | Muss | 1 | S | Die Test-Zahlung kann gezielt Erfolg, Ablehnung oder Abbruch simulieren, um alle Fälle zu prüfen. |
| ZAH-02 | Austauschbare Zahlungs-Schnittstelle | Jeder Zahlungsanbieter wird als eigener Baustein mit derselben Schnittstelle angebunden. | neu | Muss | 1 | M | Kartendaten berühren die Plattform nie, weil Zahlungen auf der Seite des Anbieters stattfinden. |
| ZAH-03 | Manuelle Zahlarten | Rechnung, Vorkasse, Barzahlung, Nachnahme, Lastschrift oder eine eigene Zahlart mit Bedingungen. | beide | Muss | 2 | M | Bei Vorkasse erscheint in der Bestätigung ein QR-Code für die Banking-App (GiroCode), damit der Kunde nichts abtippen muss. |
| ZAH-04 | Stripe | Kreditkarte und weitere Zahlarten über Stripe, bei ePages Store der Standard-Anbieter. | beide | Wäre gut | 2 | M | Für das Lernprojekt genügt der kostenlose Testmodus von Stripe. |
| ZAH-05 | PayPal | Zahlung über PayPal und die von PayPal angebotenen Zahlarten. | Now | Wäre gut | 5 | M | – |
| ZAH-06 | Mollie | Zahlung über Mollie, etwa mit Apple Pay, Kreditkarte oder iDEAL. | Now | Vielleicht später | 5 | M | – |
| ZAH-07 | Klarna und Direktüberweisung | Kauf auf Rechnung, Ratenkauf und direkte Banküberweisung über Klarna. | Now | Vielleicht später | 5 | M | – |
| ZAH-08 | Weitere länderspezifische Anbieter | Skrill, Ingenico, FirstData (Payeezy), Paybox, Redsys, Gestpay, IGFS, EVO Payments und Authorize.net. | Now | Vielleicht später | 5 | L | Solche Anbieter sollen Dritte über das App-System anbinden (siehe API-05), statt dass jeder im Kern steckt. |
| ZAH-09 | Zahlarten nach Land einschränken | Eine Zahlart gilt nur für bestimmte Länder, Regionen oder Kundengruppen. | Now | Muss | 4 | S | – |

### 2.14 Versand (Kürzel VER)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| VER-01 | Eigene Versandarten | Der Händler legt Versandarten selbst an, etwa Pauschalversand, kostenlose Lieferung, persönliche Lieferung oder Abholung, auch mit Versandkostenfreigrenze. | beide | Muss | 1 | S | – |
| VER-02 | Versandkosten nach Gewicht | Die Versandkosten richten sich nach dem Gewicht der bestellten Produkte. | beide | Wäre gut | 2 | M | – |
| VER-03 | Versandkosten nach Bestellwert | Die Versandkosten richten sich nach dem Gesamtbetrag der Bestellung. | Now | Wäre gut | 2 | S | – |
| VER-04 | Sendungsverfolgung | Der Händler trägt eine Sendungsnummer ein und der Kunde bekommt einen Link zur Verfolgung. | Now | Wäre gut | 2 | S | – |
| VER-05 | Lieferzonen | Länder werden zu Zonen zusammengefasst und jeder Zone werden Versandarten zugeordnet. | Store | Muss | 4 | M | – |
| VER-06 | Versandkosten nach Stückzahl | Die Versandkosten richten sich nach der Anzahl der bestellten Produkte. | Now | Vielleicht später | 5 | S | Gewicht, Wert und Stückzahl sind drei Regeln desselben Bausteins, nicht drei Funktionen. |
| VER-07 | Versandarten pro Produkt | Für einzelne Produkte sind nur bestimmte Versandarten erlaubt, etwa Spedition für Möbel. | Now | Wäre gut | 5 | M | – |
| VER-08 | Abholung im Laden (Click and Collect) | Kunden bezahlen oder reservieren online und holen die Ware nach einer Benachrichtigung im Laden ab. | Store | Wäre gut | 5 | M | – |
| VER-09 | Versanddienstleister direkt anbinden | Etiketten und Sendungsverfolgung direkt über DHL, FedEx oder USPS, bei FedEx auch mit Echtzeit-Versandkosten. | Now | Vielleicht später | 5 | L | – |
| VER-10 | Versandplattformen anbinden | Anbindung an Sendcloud, Packlink, Shippo, Shiptimize oder Mienvio, die viele Paketdienste bündeln. | beide | Vielleicht später | 5 | M | Solche Anbindungen sollen über das App-System entstehen (siehe API-05). |

### 2.15 Steuern und Recht in Deutschland (Kürzel STR)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| STR-01 | Steuersätze und Steuerklassen | Die Plattform kennt 19 und 7 Prozent Umsatzsteuer und ordnet jedem Produkt eine Steuerklasse zu. | Now | Muss | 1 | M | Steuersätze stehen in einer Tabelle pro Land, nicht im Programmcode. |
| STR-02 | Preisangaben „inkl. MwSt., zzgl. Versand“ | Bei jedem Preis steht, dass die Steuer enthalten ist und wo die Versandkosten zu finden sind. | beide | Muss | 1 | S | – |
| STR-03 | Grundpreis | Bei Waren nach Gewicht oder Menge zeigt der Shop automatisch den Preis pro Kilogramm, Liter oder Meter an. | beide | Muss | 1 | S | Die KI erkennt Füllmenge und Einheit aus der Produktbeschreibung oder dem Etikettenfoto. |
| STR-04 | Wesentliche Merkmale | Die wichtigsten Eigenschaften eines Produkts stehen im Checkout direkt vor dem Bestellknopf, wie es das Gesetz verlangt. | beide | Muss | 1 | S | – |
| STR-05 | Rechtstexte-Seiten | Impressum, AGB, Widerrufsbelehrung, Datenschutzerklärung sowie Versand- und Zahlungsinformationen stehen als Pflichtseiten bereit. | beide | Muss | 1 | S | Die Plattform liefert Vorlagen mit Platzhaltern und warnt, solange eine Pflichtseite leer ist. |
| STR-06 | Button-Lösung | Der Bestellknopf heißt „zahlungspflichtig bestellen“ oder ähnlich eindeutig, sonst kommt kein gültiger Vertrag zustande. | neu | Muss | 1 | S | Die Beschriftung ist fest eingebaut und kann nicht versehentlich geändert werden. |
| STR-07 | Widerrufsbelehrung und Widerrufsformular | Kunden bekommen die Belehrung und das Muster-Widerrufsformular zusammen mit Bestellbestätigung und AGB per E-Mail. | neu | Muss | 1 | S | – |
| STR-08 | Widerrufsbutton | Kunden widerrufen einen Online-Vertrag mit einem gut sichtbaren Knopf im Shop. Diese EU-Pflicht gilt seit dem 19.06.2026 (Richtlinie (EU) 2023/2673, deutsche Umsetzung zu prüfen). | neu | Muss | 1 | M | Der Widerruf landet als Vorgang direkt an der Bestellung und löst eine Eingangsbestätigung aus. |
| STR-09 | Lieferzeit | Jedes Produkt zeigt eine Lieferzeit an, etwa „Lieferzeit 2 bis 4 Werktage“. | neu | Muss | 1 | S | – |
| STR-10 | Produktsicherheitsangaben (GPSR) | Der Shop zeigt Hersteller, eine verantwortliche Person in der EU und nötige Warnhinweise an. Das verlangt die EU-Produktsicherheitsverordnung seit dem 13.12.2024. | neu | Muss | 1 | S | Herstellerangaben werden einmal gepflegt und automatisch allen Produkten dieses Herstellers zugeordnet. |
| STR-11 | Barrierefreiheit nach BFSG | Storefront und Checkout sind auch für Menschen mit Behinderung nutzbar, etwa per Tastatur oder Bildschirmleser. Das Barrierefreiheitsstärkungsgesetz gilt seit dem 28.06.2025. | neu | Muss | 1 | L | Automatische Barrierefreiheits-Tests laufen bei jeder Änderung mit, sodass Fehler gar nicht erst live gehen. |
| STR-12 | 30-Tage-Tiefstpreis | Bei einer Preisermäßigung muss der niedrigste Preis der letzten 30 Tage als Vergleich dienen (Preisangabenverordnung, Paragraf 11). | neu | Muss | 2 | S | Die Plattform berechnet den Wert automatisch aus dem gespeicherten Preisverlauf. |
| STR-13 | Cookie-Einwilligungsbanner | Besucher stimmen aktiv zu, bevor nicht notwendige Cookies oder fremde Dienste laden. Der Händler kann den Text ändern. | beide | Muss | 2 | M | Welle 1 setzt nur technisch notwendige Cookies und braucht deshalb noch keinen Banner. Der Banner erscheint automatisch erst, wenn ein Dienst aktiviert wird, der Zustimmung braucht. |
| STR-14 | Cookie-Richtlinie | Eine Seite erklärt alle Cookies und Tracking-Dienste. Besucher ändern dort ihre Einstellungen. | beide | Muss | 2 | S | Die Seite wird automatisch aus der Liste der aktivierten Dienste erzeugt. |
| STR-15 | Steuerzonen und EU-Steuern | Steuersätze für mehrere Länder werden automatisch aktuell gehalten. Der Händler wählt, ob Preise brutto oder netto angezeigt werden. Dazu gehört das EU-Verfahren OSS für Verkäufe an Privatkunden in anderen EU-Ländern. | Now | Muss | 4 | L ⚠️ | – |
| STR-16 | E-Rechnung (ZUGFeRD und XRechnung) | Rechnungen an Firmen entstehen als maschinenlesbare E-Rechnung. Unternehmen müssen E-Rechnungen seit 2025 empfangen können, die Pflicht zum Ausstellen gilt ab 2027 beziehungsweise 2028. | neu | Muss | 3 | L | Freie Bibliotheken für ZUGFeRD erzeugen PDF und Datensatz in einem Schritt. |
| STR-17 | Preiszusatz ausblenden | Der Hinweis neben dem Preis (zum Beispiel „zzgl. Versand“) lässt sich ausblenden. | Now | Vielleicht später | 3 | S | Sinnvoll ist das nur in reinen B2B-Shops. Gegenüber Privatkunden bleibt der Hinweis Pflicht und kann dort nicht abgeschaltet werden. |
| STR-18 | Rechtstexte-Dienste anbinden | Rechtstexte kommen automatisch aktuell von Anbietern wie IT-Recht Kanzlei, Händlerbund, Janolaw oder iubenda. | beide | Vielleicht später | 4 | M | Die Anbindung entsteht über das App-System (siehe API-05). |
| STR-19 | Altersprüfung | Vor dem Kauf von Alkohol, Tabak oder anderen altersbeschränkten Waren wird das Alter geprüft, etwa per Ausweis. | beide | Vielleicht später | 5 | L | – |

### 2.16 Marketing und SEO (Kürzel MKT)

SEO bedeutet Suchmaschinenoptimierung. Gemeint ist alles, was dafür sorgt, dass der Shop bei Google und anderen Suchmaschinen gut gefunden wird.

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| MKT-01 | Sprechende Adressen (URLs) | Seiten haben lesbare Adressen wie „/tee/gruener-tee“ statt Zahlenkolonnen. | beide | Muss | 1 | S | Ändert sich eine Adresse, leitet die alte automatisch auf die neue weiter. |
| MKT-02 | Seitentitel und Meta-Beschreibung | Jede Produkt- und Inhaltsseite hat vorbelegte Suchmaschinen-Einträge, die der Händler ändern kann. | beide | Muss | 2 | S | Die KI schreibt die Einträge automatisch und hält die empfohlene Länge ein. |
| MKT-03 | Sitemap | Die Plattform erstellt automatisch eine Übersicht aller Seiten für Suchmaschinen. | beide | Muss | 2 | S | – |
| MKT-04 | Strukturierte Daten | Produktseiten enthalten Preis, Verfügbarkeit und Bewertung in einer Form, die Suchmaschinen direkt verstehen (schema.org). | neu | Wäre gut | 2 | S | Dieselben Daten machen den Shop auch für KI-Suchdienste lesbar. |
| MKT-05 | Gutscheine und Kampagnen | Rabatte als fester Betrag, als Prozentsatz oder als kostenloser Versand, gültig in einem Zeitraum und gebündelt in Kampagnen. | beide | Muss | 2 | M | Der Händler sagt „10 Prozent auf alle Tees bis Sonntag“ und die KI legt die Aktion an. |
| MKT-06 | Statistik | Kennzahlen wie Umsatz, Seitenaufrufe, Besucher und Bestseller der letzten 30 Tage. | Store | Muss | 2 | M | Der Händler stellt Fragen an seine Zahlen per Chat (siehe KI-10). Die Besucherstatistik kommt ohne Cookies aus. |
| MKT-07 | SEO-Analyse und Ranking-Hilfe | Ein Check zeigt, was an den Seiten für Suchmaschinen verbessert werden kann, und verfolgt die Platzierung bei Google. Bei ePages leisten das rankingCoach, Unamo SEO, MarketGoo, Wincher und Site Booster. | beide | Wäre gut | 5 | M | Die KI prüft jede Seite und bessert Schwachstellen auf Wunsch selbst nach. |
| MKT-08 | Newsletter | Der Händler verschickt Newsletter und automatische E-Mail-Kampagnen. Bei ePages leisten das CleverReach, Sendinblue und Newsletter2Go. | beide | Wäre gut | 5 | L | Die Anmeldung läuft rechtssicher per Double-Opt-in, also mit Bestätigungsklick in einer E-Mail. |
| MKT-09 | Shop- und Produktbewertungen | Kunden bewerten Shop und Produkte, die Bewertungen erscheinen im Shop. Bei ePages leisten das ShopVote, Trustami und Trusted Shops. | beide | Wäre gut | 5 | M | Die Plattform zeigt an, ob und wie Bewertungen geprüft werden, wie es das Gesetz verlangt, und lässt nur echte Käufer bewerten. |
| MKT-10 | Trusted-Shops-Siegel | Ein Gütesiegel mit Käuferschutz erscheint im Shop. | beide | Vielleicht später | 5 | M | – |
| MKT-11 | Google Search Console | Der Händler weist bei Google nach, dass ihm der Shop gehört, und bekommt Berichte über seine Sichtbarkeit. | Now | Wäre gut | 5 | S | – |
| MKT-12 | Google Ads Tracking | Der Händler misst den Erfolg seiner Google-Werbung. | Now | Vielleicht später | 5 | S | – |
| MKT-13 | Google-Shopping-Anzeigen (Performance Max) | Produkte erscheinen automatisch als Anzeigen bei Google, YouTube und Gmail. | Now | Vielleicht später | 5 | L | – |
| MKT-14 | Data Layer für Analysen | Daten über das Einkaufsverhalten stehen in einer Standardform für Analyse-Werkzeuge bereit. | Now | Vielleicht später | 5 | S | Die Daten entstehen aus denselben Ereignissen, die auch Webhooks und Statistik nutzen. |
| MKT-15 | Werbekampagnen und Retargeting | Anzeigen bei Google, Facebook, Bing oder YouTube und gezielte Werbung für Besucher, die nicht gekauft haben. Bei ePages leisten das Clever Google Ads, Traffic Booster, AdStrong, MapAds und Releva.nz. | beide | Vielleicht später | 5 | L | – |
| MKT-16 | Social-Media-Beobachtung | Der Händler sieht, wo seine Marke in sozialen Netzwerken erwähnt wird. | Now | Vielleicht später | 5 | L | – |
| MKT-17 | Pop-ups | Fenster für Aktionen, Newsletter-Anmeldung oder beim Verlassen der Seite, auch mit A/B-Tests. | beide | Vielleicht später | 5 | M | Pop-ups sind ein Baustein im Editor und müssen barrierefrei bedienbar sein. |
| MKT-18 | Countdown | Ein Zähler zeigt, wie lange eine Aktion noch läuft. | beide | Vielleicht später | 5 | S | Der Zähler läuft automatisch mit dem Enddatum des Gutscheins (siehe MKT-05) ab. |
| MKT-19 | Browser-Push und Bildschirmnachrichten | Kurze Nachrichten erscheinen auf dem Bildschirm von Besuchern, die das erlaubt haben. | beide | Vielleicht später | 5 | M | – |

### 2.17 Vertriebskanäle (Kürzel KAN)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| KAN-01 | Verkaufskanäle als Grundkonzept | Die Storefront ist technisch ein Verkaufskanal unter mehreren möglichen. Später kommen weitere Kanäle hinzu. | neu | Muss | 1 | S | Preise, Sichtbarkeit und Bestand lassen sich pro Kanal steuern, ohne dass das Datenmodell umgebaut werden muss. |
| KAN-02 | Einkauf über KI-Assistenten | Der Shop ist für KI-Einkaufsassistenten lesbar und bedienbar, damit Kunden auch über einen Chatbot einkaufen können. | neu | Wäre gut | 4 | M | Das ist ein Kanal wie jeder andere und nutzt die öffentliche Storefront-API. |
| KAN-03 | Preisvergleichsportale und Produkt-Feeds | Produktdaten gehen automatisch an Google Shopping, idealo, billiger.de, Günstiger.de, LeGuide und eigene Portale. | Now | Wäre gut | 5 | M | Ein einziger Feed-Baukasten mit Vorlagen pro Portal ersetzt viele einzelne Anbindungen. |
| KAN-04 | Marktplätze | Produkte werden auch bei Amazon und eBay verkauft und Bestellungen kommen zurück in den Shop. | Now | Vielleicht später | 5 | XL ⚠️ | – |
| KAN-05 | Ladenkasse (POS) verbinden | Produkte, Preise und Bestände werden mit einer Kasse im Ladengeschäft abgeglichen. Bei ePages leisten das Flour und Zettle. | beide | Vielleicht später | 5 | L | – |
| KAN-06 | Social Commerce | Produkte werden direkt in Instagram oder Facebook verkauft. | neu | Vielleicht später | 5 | L | – |

### 2.18 Lager (Kürzel LAG)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| LAG-01 | Bestandsführung | Die Plattform zählt den Bestand pro Produkt und Variante und verhindert, dass mehr verkauft wird als vorhanden ist. | beide | Muss | 1 | M | Der Bestand wird beim Bestellen sicher gesperrt, damit zwei gleichzeitige Käufe nicht dasselbe letzte Stück erhalten. |
| LAG-02 | Niedriger Bestand anzeigen | Der Shop und die Produktübersicht zeigen, wenn ein Produkt knapp wird. Der Schwellwert ist pro Produkt einstellbar. | beide | Wäre gut | 2 | S | – |
| LAG-03 | Bestandswarnung per E-Mail | Der Händler bekommt eine E-Mail, wenn ein Produkt ausverkauft ist oder den Mindestbestand erreicht. | Now | Wäre gut | 2 | S | Die KI schlägt eine Nachbestellmenge auf Basis der bisherigen Verkäufe vor. |
| LAG-04 | Mehrere Lagerorte | Bestand wird getrennt pro Lager oder Laden geführt. | neu | Wäre gut | 5 | L | – |
| LAG-05 | Warenwirtschaft anbinden | Bestellungen und Bestände werden mit Warenwirtschafts- oder ERP-Systemen abgeglichen. Bei ePages leisten das DreamRobot, Xentral und Billbee. | Now | Vielleicht später | 4 | M | Die Anbindung nutzt die öffentliche API und Webhooks (siehe API-01 und API-04). |

### 2.19 Buchhaltung und Rechnungen (Kürzel BUH)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| BUH-01 | Nummernkreise | Der Händler legt das Format von Kunden-, Bestell- und Rechnungsnummern fest. Rechnungsnummern laufen lückenlos fortlaufend. | beide | Muss | 1 | S | – |
| BUH-02 | Unveränderbare Rechnungen | Eine einmal erstellte Rechnung lässt sich nicht mehr ändern, nur per Storno oder Korrektur ersetzen. Das verlangen die GoBD, die Regeln für ordnungsgemäße Buchführung. | neu | Muss | 2 | M | – |
| BUH-03 | Buchhaltungssoftware anbinden | Rechnungen, Gutschriften und Stornos gehen automatisch an Programme wie sevDesk, easybill, Lexoffice, orgaMAX oder DriveFX. | beide | Vielleicht später | 4 | M | Ein Export im DATEV-Format deckt die meisten Steuerberater ab, ohne für jede Software eine eigene Anbindung zu bauen. |

### 2.20 Sicherheit und Datenschutz (Kürzel SIC)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| SIC-01 | Verschlüsselte Verbindung (HTTPS) | Alle Daten zwischen Browser und Shop werden verschlüsselt übertragen (SSL beziehungsweise TLS). | beide | Muss | 1 | S | Zertifikate werden automatisch und kostenlos erstellt und erneuert. |
| SIC-02 | Sichere Anmeldung | Passwörter werden nur in nicht umkehrbarer Form gespeichert (Argon2). Nach mehreren Fehlversuchen wird die Anmeldung gebremst. | neu | Muss | 1 | M | – |
| SIC-03 | Rollen und Berechtigungen | Die Plattform unterscheidet mindestens zwischen Plattform-Betreiber, Händler und Kunde und prüft bei jeder Aktion, ob sie erlaubt ist. | neu | Muss | 1 | M | Dieselbe Rechteprüfung gilt für Menschen, für die KI und für Apps. |
| SIC-04 | Schutz vor typischen Angriffen | Eingaben werden geprüft. Schutz gegen die häufigsten Angriffe aus der OWASP-Top-10-Liste, etwa eingeschleusten Code oder untergeschobene Formulare. | neu | Muss | 1 | M | – |
| SIC-05 | Begrenzung von Anfragen | Zu viele Anfragen in kurzer Zeit werden gebremst, damit Bots den Shop nicht lahmlegen. | neu | Muss | 1 | S | – |
| SIC-06 | Geheimnisse sicher verwahren | Passwörter für Datenbank, E-Mail-Server oder Zahlungsanbieter stehen nie im Programmcode. | neu | Muss | 1 | S | – |
| SIC-07 | Keine Kartendaten speichern | Kreditkartendaten werden nur auf der Seite des Zahlungsanbieters eingegeben und berühren die Plattform nie. | neu | Muss | 1 | S | – |
| SIC-08 | Abhängigkeiten automatisch prüfen | Verwendete Fremdbibliotheken werden automatisch auf bekannte Sicherheitslücken geprüft. | neu | Muss | 1 | S | – |
| SIC-09 | Zwei-Faktor-Anmeldung und Passkeys | Betreiber und Händler sichern ihr Konto zusätzlich mit einem zweiten Faktor oder einem Passkey ab. | neu | Muss | 2 | M | – |
| SIC-10 | Datenschutz-Rechte (DSGVO) | Kunden bekommen auf Anfrage alle ihre Daten als Datei und können sie löschen lassen. Aufbewahrungspflichten für Rechnungen bleiben dabei gewahrt. | neu | Muss | 2 | M | Der Händler sagt „Frau Müller möchte ihre Daten gelöscht haben“ und die KI erledigt Export und Löschung mit Bestätigung. |
| SIC-11 | Datensparsamkeit | Alte Daten, die nicht mehr gebraucht werden, werden automatisch anonymisiert oder gelöscht. | neu | Wäre gut | 5 | M | – |

### 2.21 Apps, API und Erweiterungen (Kürzel API)

API heißt „Programmierschnittstelle“. Gemeint ist ein fest beschriebener Weg, über den andere Programme, Apps oder die KI mit der Plattform arbeiten können.

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| API-01 | Vollständige Admin-API | Alles, was der Händler im Backoffice tun kann, geht auch über die API. Das Backoffice selbst nutzt nur diese API. | neu | Muss | 1 | L | Die KI nutzt genau diese API und bekommt keine Sonderwege. |
| API-02 | Storefront-API | Eine öffentliche Schnittstelle liefert Produkte, Kategorien, Warenkorb und Checkout für die Storefront. | neu | Muss | 1 | M | – |
| API-03 | Automatische API-Dokumentation | Die Beschreibung der API (OpenAPI) entsteht automatisch aus dem Programmcode und ist immer aktuell. | neu | Muss | 1 | S | – |
| API-04 | Webhooks | Externe Systeme bekommen bei Ereignissen wie „neue Bestellung“ automatisch eine Nachricht. | neu | Muss | 4 | M | Jede Nachricht ist signiert, damit der Empfänger prüfen kann, dass sie echt ist. |
| API-05 | App-System | Dritte entwickeln Apps, die der Händler installiert. Jede App bekommt nur die Rechte, denen der Händler zustimmt. | neu | Muss | 4 | XL ⚠️ | Apps laufen außerhalb der Plattform und sprechen nur über API und Webhooks mit ihr. Das ist sicherer und einfacher als Plugins im Kern. |
| API-06 | App-Store im Backoffice | Der Händler findet, filtert und installiert Apps. Er sieht, was installiert ist, und bekommt Apps passend an der richtigen Stelle im Backoffice vorgeschlagen. | beide | Wäre gut | 4 | L | Statt im Katalog zu suchen, fragt der Händler die KI, welche App sein Problem löst. |
| API-07 | Erweiterungspunkte für Apps | Apps können eigene Bausteine in Backoffice und Storefront einfügen. | neu | Wäre gut | 4 | XL ⚠️ | – |
| API-08 | API-Schlüssel für Händler | Der Händler erzeugt einen Schlüssel, um mit eigenen Skripten oder Werkzeugen auf seinen Shop zuzugreifen. | neu | Wäre gut | 4 | S | – |
| API-09 | Zusatzfelder | Händler und Apps legen eigene Felder an Produkten, Kunden oder Bestellungen an, etwa „Allergene“. | neu | Wäre gut | 4 | M | – |

### 2.22 KI-Funktionen (Kürzel KI)

Diese Funktionen fehlen in beiden ePages-Listen. Sie sind der Kern der Idee „KI zuerst“: Der Händler soll möglichst alles per Chat erledigen können, auch mit Bildern.

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| KI-01 | KI-Assistent im Backoffice | Ein Chat im Backoffice, der Fragen beantwortet und Aufgaben im Shop ausführt, etwa Produkte anlegen oder Preise ändern. | neu | Muss | 2 | XL ⚠️ | Der Assistent arbeitet ausschließlich über die Admin-API und hat genau die Rechte des angemeldeten Händlers. |
| KI-02 | MCP-Schnittstelle | Die API-Funktionen stehen der KI als Werkzeuge über das Model Context Protocol (MCP) zur Verfügung, einen offenen Standard für KI-Werkzeuge. | neu | Muss | 2 | M | So kann der Händler seinen Shop auch aus anderen KI-Programmen heraus steuern. |
| KI-03 | Bestätigung und Rückgängig für KI-Aktionen | Kritische Aktionen wie Löschen, Preisänderungen oder Erstattungen führt die KI erst nach Bestätigung aus. Jede KI-Aktion ist protokolliert und lässt sich zurücknehmen. | neu | Muss | 2 | M | – |
| KI-04 | Produkt aus Foto anlegen | Der Händler lädt ein Foto hoch und die KI schlägt Name, Beschreibung, Merkmale, Kategorie und Schlagworte vor. | neu | Muss | 2 | L | – |
| KI-05 | Texte schreiben lassen | Die KI schreibt Produkttexte, Kategorietexte und Suchmaschinen-Einträge im Ton des Shops. Sie ersetzt damit die App Greatcontent. | neu | Muss | 2 | S | – |
| KI-06 | Bilder bearbeiten lassen | Die KI stellt Produkte frei, vereinheitlicht Hintergründe und schneidet Bilder passend zu. Sie ersetzt damit die App Pixelz. | neu | Wäre gut | 2 | M | Dafür genügen freie Bildmodelle, die auf dem eigenen Server laufen. |
| KI-07 | KI-Widget im Shop-Editor | Der Händler beschreibt, was auf einer Seite erscheinen soll, und die KI baut daraus Abschnitte und Bausteine als Entwurf. | neu | Muss | 2 | L | Die KI erzeugt nur Bausteine aus dem vorhandenen Baukasten, keinen freien Code. Dadurch ist das Ergebnis immer sicher und bearbeitbar. |
| KI-08 | Shop aus Beschreibung erstellen | Der Händler beschreibt sein Geschäft und die KI richtet Design, Startseite, Kategorien und erste Rechtstexte-Vorlagen ein. | neu | Wäre gut | 2 | L | – |
| KI-09 | Lokales Open-Source-Modell, austauschbar | Die KI läuft standardmäßig mit einem freien Modell auf dem eigenen Server. Der Anbieter lässt sich austauschen. | neu | Muss | 2 | M | – |
| KI-10 | Fragen an die eigenen Zahlen | Der Händler fragt etwa „Was lief letzte Woche am besten?“ und bekommt eine Antwort mit Zahlen. | neu | Wäre gut | 2 | M | – |
| KI-11 | Kennzeichnung von KI-Inhalten | Wo Kunden mit einer KI sprechen oder KI-erzeugte Inhalte sehen, wird das kenntlich gemacht. Die Transparenzpflichten des EU-AI-Acts gelten ab dem 02.08.2026. | neu | Muss | 2 | S | – |
| KI-12 | Übersetzung per KI | Die KI übersetzt Produkte, Seiten und E-Mails in andere Sprachen und der Händler prüft das Ergebnis. Sie ersetzt damit die App Lengoo. | neu | Muss | 4 | M | – |
| KI-13 | Kluge Suche im Shop | Kunden suchen in ganzen Sätzen, etwa „Geschenk für eine Gärtnerin unter 30 Euro“, und bekommen passende Produkte. | neu | Wäre gut | 5 | L | Die Suche läuft mit der freien PostgreSQL-Erweiterung pgvector, ohne zusätzlichen Dienst. |
| KI-14 | Kunden-Chat im Shop | Kunden stellen Fragen im Shop und bekommen Antworten von einer KI oder live vom Händler. Bei ePages leistet das die App Smartsupp. | beide | Vielleicht später | 5 | L | Die KI beantwortet Standardfragen selbst und übergibt schwierige Fälle an den Händler. |
| KI-15 | Logos und Bilder erzeugen | Die KI entwirft Logos, Banner und Hintergrundbilder. Sie ersetzt damit die App Logaster. | neu | Vielleicht später | 5 | M | – |
| KI-16 | Spracheingabe | Der Händler diktiert Aufgaben, statt sie zu tippen. | neu | Wäre gut | 5 | M | – |

### 2.23 B2B (Kürzel B2B)

B2B heißt „Business to Business“, also Verkauf an Firmen statt an Privatpersonen. Einige B2B-Funktionen stehen schon in anderen Bereichen: Staffelpreise (PRS-04), Kundengruppenpreise (PRS-05), Kundengruppen (KND-05), Mindestbestellwert (WKC-05), Warenkorbrabatt (WKC-06), manuelle Bestellung (BST-13) und E-Rechnung (STR-16).

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| B2B-01 | Firmenkonten | Eine Firma hat ein Konto mit mehreren Ansprechpartnern und Lieferadressen. | neu | Muss | 3 | L | – |
| B2B-02 | Nettopreise für Geschäftskunden | Geschäftskunden sehen Preise ohne Umsatzsteuer. | neu | Muss | 3 | S | – |
| B2B-03 | Kauf auf Rechnung mit Zahlungsziel | Geschäftskunden zahlen erst nach Lieferung innerhalb einer Frist, zum Beispiel 30 Tage, bis zu einem Kreditlimit. | neu | Muss | 3 | M | – |
| B2B-04 | USt-IdNr. prüfen und Reverse Charge | Die Umsatzsteuer-Identifikationsnummer wird online geprüft. Bei Firmen im EU-Ausland entfällt dann die deutsche Umsatzsteuer. | neu | Muss | 3 | M | Die Prüfung läuft über den kostenlosen Dienst VIES der EU. |
| B2B-05 | Mengenregeln und Verpackungseinheiten | Produkte gibt es nur in bestimmten Mengen, etwa ab 10 Stück oder im 6er-Pack. | neu | Wäre gut | 3 | M | – |
| B2B-06 | Kundenspezifische Sortimente | Bestimmte Kunden sehen nur ausgewählte Produkte. | neu | Wäre gut | 3 | L | – |
| B2B-07 | Angebotsanfrage | Kunden fragen ein Angebot an, der Händler passt Preise an und schickt es zurück. | neu | Wäre gut | 3 | L | Die KI erstellt aus einer formlosen Anfrage per E-Mail einen fertigen Angebotsentwurf. |
| B2B-08 | Schnellbestellung | Kunden bestellen über Artikelnummern oder eine hochgeladene Liste. | neu | Wäre gut | 3 | M | Die KI liest auch ein Foto einer handschriftlichen Bestellliste. |
| B2B-09 | Nachbestellen | Kunden bestellen eine frühere Bestellung mit einem Klick erneut. | neu | Wäre gut | 3 | S | – |
| B2B-10 | Geschlossener Shop | Preise oder der ganze Shop sind nur für angemeldete und freigeschaltete Kunden sichtbar. | neu | Wäre gut | 3 | S | – |
| B2B-11 | Freigabe-Abläufe | Bestellungen von Einkäufern müssen erst von einer berechtigten Person in der Firma freigegeben werden. | neu | Vielleicht später | 3 | L | – |

### 2.24 Internationalisierung (Kürzel INT)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| INT-01 | Mehrsprachigkeit | Der Shop erscheint in mehreren Sprachen, bei ePages Now in bis zu 15. Das betrifft Produkte, Seiten, E-Mails und Dokumente. | Now | Muss | 4 | L | Die KI übersetzt automatisch (siehe KI-12), der Händler prüft nur noch. |
| INT-02 | Länder und Regionen | Der Händler legt fest, in welche Länder er liefert, und fasst Länder zu Regionen zusammen, um Zahl- und Versandarten einzuschränken. | Now | Muss | 4 | M | – |
| INT-03 | Mehrere Währungen | Preise gibt es in verschiedenen Währungen, entweder fest gepflegt oder umgerechnet. | neu | Muss | 4 | L | – |
| INT-04 | Adressformate pro Land | Das Adressformular passt sich dem Land an, etwa mit Bundesstaat in den USA. | neu | Muss | 4 | M | – |
| INT-05 | Märkte | Ein Markt bündelt Land, Sprache, Währung, Domain und Preise, etwa „Schweiz, Deutsch und Französisch, Franken“. | neu | Wäre gut | 4 | L | Der Händler sagt „Ich will auch nach Österreich verkaufen“ und die KI richtet den Markt mit allen nötigen Einstellungen ein. |
| INT-06 | Rechtstexte pro Land | Jedes Land bekommt eigene Rechtstexte in der passenden Sprache. | neu | Wäre gut | 4 | M | – |

### 2.25 Support und Hilfe (Kürzel SUP)

| ID | Feature | Erklärung | Quelle | Priorität | Welle | Aufwand | Neu gedacht |
|---|---|---|---|---|---|---|---|
| SUP-01 | Hilfe-Center im Backoffice | Hilfeartikel lassen sich direkt aus dem Backoffice heraus durchsuchen. | beide | Wäre gut | 2 | M | Der KI-Assistent beantwortet Bedienfragen aus der Hilfe und führt den Schritt auf Wunsch gleich selbst aus. |
| SUP-02 | Support-Kontakt | Eine Seite im Backoffice nennt alle Wege, Hilfe zu bekommen, etwa per E-Mail oder Telefon. | beide | Vielleicht später | 5 | S | – |
| SUP-03 | Video-Anleitungen und Blog | Anleitungsvideos und Fachartikel erklären die Plattform. | Now | Vielleicht später | 5 | S | – |

---

## 3. Welle 1 im Überblick

Welle 1 ist das MVP, also das kleinste Produkt, mit dem man den kompletten Ablauf von „Produkt anlegen“ bis „Kauf abgeschlossen“ durchspielen kann. Es gilt nur Deutschland, nur Euro und nur eine Test-Zahlung. Die folgenden 63 Funktionen haben alle die Priorität „Muss“. Die IDs verweisen auf die Tabellen in Kapitel 2.

**Plattform-Verwaltung und Betrieb (12 Funktionen)**
- PLA-01 Plattform-Admin-Oberfläche: Der Betreiber sieht alle Händler und Shops.
- PLA-02 Händler und Shops anlegen, sperren, löschen: Ein neuer Shop startet mit fertigen Voreinstellungen.
- PLA-03 Mandantentrennung: Jeder Shop sieht nur seine eigenen Daten, abgesichert in der Datenbank.
- PLA-04 Händler-Login und Kontoeinstellungen: Der Händler meldet sich an und pflegt seine Kontodaten.
- PLA-05 Kostenlose Subdomain pro Shop: Jeder Shop ist unter einer eigenen Adresse erreichbar.
- PLA-06 Plattform-Grundeinstellungen: Mailserver, Speicher und KI-Modell werden zentral eingestellt.
- PLA-07 Änderungsprotokoll: Jede wichtige Änderung wird mit Urheber gespeichert.
- BET-01 Automatische Updates: Neue Versionen und Datenbank-Änderungen werden automatisch eingespielt.
- BET-02 Selbst betreibbar mit einem Befehl: Die Plattform läuft komplett mit freier Software.
- BET-03 Datensicherung und Wiederherstellung: Daten werden regelmäßig gesichert.
- BET-04 Dateispeicher für Bilder und Dokumente: Bilder liegen in einem selbst betriebenen Speicher.
- BET-05 Hintergrundaufgaben: E-Mails und Bildverarbeitung laufen im Hintergrund.

**Händler-Backoffice (11 Funktionen)**
- EIN-01 Allgemeine Einstellungen: Firmendaten und Shopname werden gepflegt.
- EIN-02 Shop online oder offline schalten: Der Händler bestimmt, wann sein Shop sichtbar ist.
- PRD-01 Produkte anlegen: Produkte mit Name, Beschreibung, Bild, Preis und Artikelnummer.
- PRD-02 Produkt bearbeiten: Jedes Produkt hat eine eigene Bearbeitungsseite.
- PRD-03 Produktübersicht: Alle Produkte stehen in einer Liste mit Schnellbearbeitung.
- PRD-04 Entwurf oder veröffentlicht: Produkte sind erst sichtbar, wenn der Händler sie freigibt.
- PRD-05 Produktbilder: Bilder werden automatisch in passende Größen umgerechnet.
- PRS-01 Preis mit Steuerklasse: Preise stehen bereits in einer erweiterbaren Preistabelle.
- KAT-01 Kategorien anlegen und Produkte zuordnen: Kategorien bilden das Menü des Shops.
- LAG-01 Bestandsführung: Es wird nie mehr verkauft als vorhanden ist.
- BUH-01 Nummernkreise: Bestell- und Kundennummern folgen einem festen Format.

**Storefront, Warenkorb und Checkout (10 Funktionen)**
- EDI-01 Responsives Standard-Design: Ein festes, barrierefreies Design für alle Geräte.
- EDI-02 Footer mit Pflichtseiten: Alle Rechtstexte sind von jeder Seite aus erreichbar.
- INH-01 Einfache Textseiten: Seiten für Impressum, AGB und Ähnliches.
- STF-01 Grundgerüst der Storefront: Startseite, Kategorie, Produkt, Warenkorb und Checkout.
- STF-02 Produktdarstellung: Produktlisten und Produktseiten mit allen Pflichtangaben.
- WKC-01 Warenkorb: Produkte hinzufügen, Menge ändern, entfernen.
- WKC-02 Sicherer, rechtskonformer Checkout: Adresse, Versand, Zahlung, Prüfen, Bestellen.
- WKC-03 Bestellung als Gast: Kaufen ohne Kundenkonto.
- MKT-01 Sprechende Adressen: Lesbare URLs von Anfang an, damit später nichts umgeleitet werden muss.
- KAN-01 Verkaufskanäle als Grundkonzept: Die Storefront ist der erste von mehreren möglichen Kanälen.

**Bestellungen, Zahlung und Versand (8 Funktionen)**
- BST-01 Bestellübersicht: Alle Bestellungen mit Status.
- BST-02 Bestelldetails mit Verlauf: Unveränderliche Kopie aller Kaufdaten und eine Zeitleiste.
- BST-03 Status ändern: Bezahlt, versendet, zugestellt.
- BST-04 Benachrichtigung bei neuer Bestellung: Meldung im Backoffice und per E-Mail.
- BST-05 Bestellbestätigung per E-Mail: Der Kunde bekommt alle Pflichtangaben.
- ZAH-01 Test-Zahlung: Ein simulierter Zahlungsablauf mit Erfolg, Ablehnung und Abbruch.
- ZAH-02 Austauschbare Zahlungs-Schnittstelle: Echte Anbieter lassen sich später ohne Umbau einstecken.
- VER-01 Eigene Versandarten: Mindestens ein Pauschalversand.

**Deutsches Recht, Mindestumfang (11 Funktionen)**
- STR-01 Steuersätze und Steuerklassen: 19 und 7 Prozent.
- STR-02 Preisangaben „inkl. MwSt., zzgl. Versand“: Bei jedem Preis.
- STR-03 Grundpreis: Preis pro Kilogramm, Liter oder Meter.
- STR-04 Wesentliche Merkmale: Direkt vor dem Bestellknopf.
- STR-05 Rechtstexte-Seiten: Impressum, AGB, Widerruf, Datenschutz, Versand und Zahlung.
- STR-06 Button-Lösung: Der Knopf heißt „zahlungspflichtig bestellen“.
- STR-07 Widerrufsbelehrung und Widerrufsformular: In der Bestätigungs-E-Mail.
- STR-08 Widerrufsbutton: Widerruf per Knopf im Shop, EU-Pflicht seit Juni 2026.
- STR-09 Lieferzeit: Bei jedem Produkt.
- STR-10 Produktsicherheitsangaben (GPSR): Hersteller und verantwortliche Person in der EU.
- STR-11 Barrierefreiheit nach BFSG: Storefront und Checkout sind barrierefrei.

**Sicherheit und API (11 Funktionen)**
- SIC-01 Verschlüsselte Verbindung (HTTPS).
- SIC-02 Sichere Anmeldung mit geschützten Passwörtern und Bremse bei Fehlversuchen.
- SIC-03 Rollen und Berechtigungen für Betreiber, Händler und Kunde.
- SIC-04 Schutz vor typischen Angriffen nach OWASP Top 10.
- SIC-05 Begrenzung von Anfragen gegen Bots.
- SIC-06 Geheimnisse sicher verwahren, nie im Programmcode.
- SIC-07 Keine Kartendaten speichern.
- SIC-08 Abhängigkeiten automatisch auf Sicherheitslücken prüfen.
- API-01 Vollständige Admin-API: Das Backoffice nutzt nur diese API.
- API-02 Storefront-API: Die Storefront nutzt nur diese API.
- API-03 Automatische API-Dokumentation.

Bewusst nicht in Welle 1 sind Varianten, Kundenkonten, Rechnungs-PDFs, Produktsuche, Gutscheine, der visuelle Editor und alle KI-Funktionen. Diese Funktionen folgen in Welle 2. Das Datenmodell ist aber schon in Welle 1 so angelegt, dass sie ohne Umbau hinzukommen (siehe Kapitel 4).

---

## 4. Architektur-Hinweise: Was das Datenmodell schon in Welle 1 können muss

Diese Punkte werden in Welle 1 noch nicht als sichtbare Funktion gebaut. Sie müssen aber in der Datenbank und in den Schnittstellen von Anfang an vorgesehen sein. Sonst müsste man später große Teile umbauen, und genau solche Sackgassen soll es nicht geben.

| Nr. | Was vorbereiten | Wie es in Welle 1 aussieht | Warum | Betrifft später |
|---|---|---|---|---|
| A-01 | Shop-Kennung an jedem Datensatz | Jede Tabelle hat eine Spalte für den Shop, die Datenbank filtert automatisch danach. | Mandantentrennung lässt sich nachträglich kaum sicher einbauen. | PLA-03, alle Bereiche |
| A-02 | Preise in eigener Preistabelle | Ein Preis hat Betrag, Währung, Verkaufskanal, Kundengruppe, Mindestmenge und Gültigkeitszeitraum. In Welle 1 gibt es genau einen Preis pro Variante in Euro für Endkunden. | Staffelpreise, Gruppenpreise, Währungen und Aktionspreise sind dann nur zusätzliche Zeilen. | PRS-02 bis PRS-06, INT-03, B2B-02 |
| A-03 | Preisverlauf | Jede Preisänderung wird mit Datum gespeichert. | Der 30-Tage-Tiefstpreis braucht die Vergangenheit, und die lässt sich nicht nachträglich erzeugen. | STR-12, PRS-02 |
| A-04 | Geldbeträge als ganze Zahlen mit Währung | Beträge werden in Cent gespeichert und tragen immer einen Währungscode. | Kommazahlen erzeugen Rundungsfehler, und ohne Währungscode wäre Mehrwährung ein Umbau. | INT-03, BUH |
| A-05 | Jedes Produkt hat mindestens eine Variante | Bestand, Preis und Artikelnummer hängen an der Variante, nicht am Produkt. Ein einfaches Produkt hat genau eine Variante. | So kommen echte Varianten später ohne Datenumbau hinzu. | PRD-09 bis PRD-11, LAG |
| A-06 | Generische Produktmerkmale | Merkmale (Name und Wert) sind eine eigene Struktur, auch wenn Welle 1 sie noch nicht anzeigt. | Produkttypen, Filter und Varianten bauen darauf auf. | PRD-09, PRD-10, STF-09 |
| A-07 | Übersetzbare Texte | Alle Texte, die Kunden sehen (Produktname, Beschreibung, Seiten, E-Mails), werden mit einem Sprachcode gespeichert. In Welle 1 gibt es nur Deutsch. | Mehrsprachigkeit nachträglich einzubauen betrifft sonst jede Tabelle. | INT-01, KI-12 |
| A-08 | Steuerklassen statt Steuersätze am Produkt | Das Produkt kennt nur „normal“ oder „ermäßigt“. Der Prozentsatz kommt aus einer Tabelle pro Land. | Andere Länder und Steueränderungen brauchen dann keine Produktänderung. | STR-15, B2B-04 |
| A-09 | Brutto- oder Nettopreis-Kennzeichen | Jeder Preis und jeder Kanal weiß, ob er brutto oder netto gemeint ist. | B2B rechnet netto, Privatkunden sehen brutto. | B2B-02, STR-15 |
| A-10 | Kundengruppen | Es gibt eine Standardgruppe „Endkunden“, zu der jeder Kunde und jeder Gast gehört. | Gruppenpreise und B2B hängen an Gruppen. | KND-05, PRS-05, B2B |
| A-11 | Firmen als mögliche Kunden | Ein Kunde kann optional zu einer Firma gehören. In Welle 1 bleibt das Feld leer. | Firmenkonten mit mehreren Ansprechpartnern brauchen diese Verbindung. | B2B-01, B2B-11 |
| A-12 | Adressen mit Ländercode | Adressen speichern einen Ländercode und flexible Felder, nicht nur deutsche Felder. | Andere Länder haben andere Adressformate. | INT-02, INT-04 |
| A-13 | Verkaufskanäle | Es gibt einen Kanal „Storefront“, an dem Preise, Sichtbarkeit und Bestellungen hängen. | Marktplätze, KI-Assistenten und Ladenkasse sind dann weitere Kanäle. | KAN-01 bis KAN-06 |
| A-14 | Lagerorte | Der Bestand wird pro Variante und Lagerort geführt. In Welle 1 gibt es ein Standardlager. | Mehrere Lager und Click and Collect brauchen Lagerorte. | LAG-04, VER-08 |
| A-15 | Bestellung als unveränderliche Kopie | Die Bestellung speichert Preise, Steuern, Produkttexte und die Version der Rechtstexte zum Kaufzeitpunkt. | Spätere Änderungen am Produkt dürfen alte Bestellungen und Rechnungen nicht verändern. | BST-08, BUH-02 |
| A-16 | Getrennte Status | Bestellung, Zahlung und Versand haben je einen eigenen Status. | Teillieferungen, Teilzahlungen und Retouren sind dann möglich. | BST-06, BST-07 |
| A-17 | Seiten als strukturierte Daten | Seiten werden als Liste von Abschnitten und Bausteinen gespeichert (JSON), nicht als fertiges HTML. | Der Editor und die KI arbeiten auf dieser Struktur. | EDI-03, INH-02, KI-07 |
| A-18 | Ereignisse für jede Änderung | Jede wichtige Änderung erzeugt ein Ereignis, etwa „Bestellung angelegt“, das in einer eigenen Tabelle festgehalten wird. | Webhooks, Apps, Statistik, Audit-Log und KI hängen sich an diese Ereignisse. | API-04, API-05, MKT-06, MKT-14 |
| A-19 | Nutzer, Mitgliedschaften und Rollen | Ein Nutzer gehört über eine Mitgliedschaft mit Rolle zu einem Shop. In Welle 1 hat jeder Shop genau einen Inhaber. | Mitarbeiter, Support-Zugriff, Apps und KI brauchen abgestufte Rechte. | PLA-08, PLA-09, API-05, KI-01 |
| A-20 | Tarif und Funktionsschalter | Jeder Shop verweist auf einen Tarif. In Welle 1 gibt es einen Standardtarif mit allen Funktionen. | Tarife und das Website-Paket sind dann nur Konfiguration. | PLA-10, PLA-11 |
| A-21 | Zahlungs- und Versand-Adapter | Zahlung und Versandkostenberechnung laufen über eine feste Schnittstelle, hinter der in Welle 1 nur Test-Zahlung und Pauschalversand stecken. | Neue Anbieter und Versandregeln kommen als weitere Adapter hinzu. | ZAH, VER |
| A-22 | Länder, Zonen und Märkte | Der Shop hat ein Verkaufsland „Deutschland“ in einer Zone, statt dass Deutschland fest im Code steht. | Internationalisierung ist dann Konfiguration statt Umbau. | INT-02, INT-05, VER-05 |
| A-23 | Nummernkreise pro Shop | Bestell-, Kunden- und Rechnungsnummern kommen aus einem eigenen Zähler pro Shop und Dokumentart. | Lückenlose Rechnungsnummern sind gesetzlich nötig. | BUH-01, BST-08 |
| A-24 | Zusatzfelder | Produkte, Kunden und Bestellungen haben ein Feld für frei definierbare Zusatzangaben. | Apps und Spezialfälle brauchen eigene Daten, ohne die Tabellen zu ändern. | API-09 |
| A-25 | Produktsicherheit und Hersteller | Hersteller ist ein eigener Datensatz mit Adresse und verantwortlicher Person, verbunden mit Produkten. | GPSR, Filter nach Hersteller und automatische Kategorien nutzen diese Daten. | STR-10, STF-09, KAT-03 |
| A-26 | Versionierte API | Die API trägt eine Versionsnummer und Änderungen bleiben rückwärtskompatibel. | Apps von Dritten dürfen nicht bei jedem Update kaputtgehen. | API-05 |
| A-27 | Eindeutige, nicht erratbare IDs | Datensätze bekommen zufällige IDs (UUID) statt fortlaufender Zahlen. Zeiten werden einheitlich in UTC gespeichert. | Fortlaufende IDs verraten Geschäftszahlen und erleichtern Angriffe. Einheitliche Zeiten vermeiden Fehler über Zeitzonen hinweg. | SIC, INT |
| A-28 | Archivieren statt Löschen | Produkte und Kunden mit Bestellungen werden archiviert statt gelöscht. | Rechnungen müssen zehn Jahre aufbewahrt werden, und Bestellungen dürfen nicht ins Leere zeigen. | SIC-10, BUH-02 |

---

## 5. Zahlen zum Katalog

| | Muss | Wäre gut | Vielleicht später | Summe |
|---|---|---|---|---|
| Welle 1 | 63 | 0 | 0 | 63 |
| Welle 2 | 41 | 57 | 0 | 98 |
| Welle 3 | 8 | 9 | 2 | 19 |
| Welle 4 | 10 | 7 | 3 | 20 |
| Welle 5 | 0 | 23 | 38 | 61 |
| Summe | 122 | 96 | 43 | 261 |

Nach Quelle verteilen sich die 261 Funktionen so: 104 stehen in beiden ePages-Listen, 42 nur in ePages Now, 30 nur in ePages Store und 85 sind neu ergänzt.

---

## Anhang A: Partner-Apps aus den ePages-Listen und wo sie im Katalog stehen

Beide ePages-Produkte ergänzen ihren Funktionsumfang mit Apps von Partnern. Die folgende Tabelle ordnet jede genannte App der Funktion in diesem Katalog zu, die denselben Zweck erfüllt. Viele Apps werden bei uns durch eine KI-Funktion oder einen Editor-Baustein ersetzt.

| App | Zweck laut ePages | Quelle | Bei uns abgedeckt durch |
|---|---|---|---|
| CleverReach, Sendinblue, Newsletter2Go | E-Mail-Marketing und Newsletter | Now (CleverReach, Sendinblue), Store (Newsletter2Go) | MKT-08 |
| POWr Social Feed | Social-Media-Beiträge im Shop | beide | INH-16 |
| POWr gallery, POWr Media Gallery | Galerie und Lookbook | beide | INH-08 |
| Unamo SEO, MarketGoo, Wincher, Site Booster, rankingCoach | SEO-Analyse und Ranking-Verfolgung | beide (rankingCoach in Store nativ eingebunden) | MKT-07 |
| Unamo Social Media | Beobachtung der Marke in sozialen Netzwerken | Now | MKT-16 |
| Clever Google Ads, Traffic Booster, AdStrong, MapAds, Releva.nz | Werbekampagnen und Retargeting | beide (Releva.nz in beiden) | MKT-15 |
| Marktfeed, EasyAds | Produkte auf Marktplätze und Vergleichsportale bringen | Now | KAN-03, KAN-04 |
| Signalize, Cleverpush | Kurznachrichten und Browser-Push | beide (Cleverpush in beiden) | MKT-19 |
| Smartarget Follow Us | Social-Media-Knöpfe | Now | EDI-14 |
| Smartarget Contact Us | Kontakt über soziale Netzwerke | Now | INH-11 |
| POWr Popup, Poptin | Pop-ups, auch mit A/B-Tests | beide | MKT-17 |
| POWr Countdown Timer | Countdown für Aktionen | beide | MKT-18 |
| Janolaw, IT-Recht Kanzlei, Händlerbund AGB Texter, iubenda | Rechtstexte | beide (IT-Recht Kanzlei in beiden) | STR-18 |
| CookieFirst | Cookie-Einwilligung und Cookie-Richtlinie | beide | STR-13, STR-14 |
| Pixelz | Bildbearbeitung | Now | KI-06 |
| Lengoo | Übersetzungen | Now | KI-12, INT-01 |
| Greatcontent | SEO-Texte | Now | KI-05 |
| Logaster | Logo-Erstellung | Now | KI-15, EDI-07 |
| SendCloud, Packlink PRO, Shippo, Shiptimize, Mienvio | Versandabwicklung und Etiketten | beide (Sendcloud und Shippo in beiden) | VER-10 |
| Billbee (digitale Produkte) | Verkauf digitaler Produkte | Now | PRD-21 |
| Billbee, DreamRobot, Xentral ERP | Auftrags- und Warenwirtschaft | Now | LAG-05 |
| sevDesk, easybill, Lexoffice, DriveFX, orgaMAX | Buchhaltung und Rechnungen | beide (orgaMAX in beiden) | BUH-03 |
| Flour.io, Zettle by PayPal | Ladenkasse und Bestandsabgleich | beide (Flour in beiden) | KAN-05 |
| Shore, Shore-Buchungsknopf | Terminbuchung und Kundenverwaltung für Läden | beide | INH-17 |
| Smartsupp | Live-Chat und Besucheranalyse | beide | KI-14 |
| POWr Form Builder | Formulare | beide | INH-15 |
| POWr FAQ | Häufige Fragen | beide | INH-10 |
| Validation.com, Fraspy | Ausweis- und Altersprüfung | beide (Fraspy nur Store) | STR-19 |
| Trustami, ShopVote, Trusted Shops | Bewertungen und Gütesiegel | beide | MKT-09, MKT-10 |
| App-Store allgemein (über 60 Apps, Kategorien) | Apps finden und installieren | beide | API-05, API-06 |
