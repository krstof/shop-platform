# Marktanalyse: Wie die führenden Shop-Systeme gebaut sind und was wir übernehmen

Stand: 27.10.2026. Zweck: Grundlage für ein privates Lernexperiment, in dem Claude eine mandantenfähige Shop-Plattform (Admin-Ebene, Händler-Backoffice mit visuellem Editor, Storefront pro Shop) baut.

**Disclaimer zur Belastbarkeit:** Die Web-Recherche lieferte für einige Systeme (vor allem Shopify, Shopware und ePages) überwiegend Sekundärquellen und Blogartikel. Aussagen zu Architektur und Preismodell von commercetools, Medusa und Vendure stützen sich auf deren offizielle Dokumentation. Aussagen zu KI-Funktionen ändern sich quartalsweise und sind als Momentaufnahme zu lesen. Wo ich etwas aus Fachwissen ergänzt habe und nicht einzeln belegen konnte, steht der Hinweis „zu prüfen“. Rechtliche Punkte sind eine technische Anforderungsliste und keine Rechtsberatung.

**Bewertungsskala in diesem Dokument:** 1 = beste Eignung, 9 = schlechteste Eignung.

---

## 1. Kurzfassung (das Wichtigste vorab)

1. **Ein modularer Monolith ist richtig.** Shopify, das größte System der Welt, läuft im Kern ebenfalls als modularer Monolith. Ein modularer Monolith ist eine einzige Anwendung, die intern in streng getrennte Bausteine (Module) zerlegt ist. Das ist für uns einfacher zu bauen und zu betreiben als viele kleine Dienste, und man kann Module später herauslösen.
2. **Mandantentrennung in der Datenbank erzwingen.** Wir nutzen PostgreSQL mit Row-Level-Security (RLS), also einer Regel direkt in der Datenbank, die jeder Abfrage automatisch „nur Daten dieses Shops“ aufzwingt. Selbst wenn der Anwendungscode einen Fehler hat, liefert die Datenbank dann keine fremden Daten aus.
3. **Das Datenmodell muss von Anfang an „Kanäle“ kennen.** Alle Profis (Saleor, Vendure, Medusa, Shopware, commercetools) trennen einen Verkaufskanal (Shop, Land, Währung, Kundengruppe) vom Produkt selbst. Preise gehören nicht ans Produkt, sondern in eine eigene Preistabelle mit Währung, Kanal, Kundengruppe, Mindestmenge und Gültigkeitszeitraum. Damit sind B2B und Mehrsprachigkeit später ohne Umbau möglich.
4. **API zuerst, KI als Nutzer der API.** Jede Funktion existiert als sauber beschriebene API. Der KI-Assistent des Händlers bekommt dieselben Funktionen als „Werkzeuge“ (über das Model Context Protocol, kurz MCP, einen Standard, über den KI-Modelle Programme bedienen). Es gibt keine Sonderwege für die KI.
5. **Der Editor speichert Struktur, nicht HTML.** Shopify (Sections und Blocks), Shopware (Erlebniswelten) und Medusa-/Headless-Ansätze zeigen: Eine Seite ist eine Liste aus Abschnitten, Blöcken und Einstellungen als JSON-Daten. Daraus rendert die Storefront die Seite. Das ist sicher, versionierbar und für KI gut erzeugbar.
6. **Zahlung und Kartendaten nie selbst anfassen.** Gehostete Bezahlseiten von Zahlungsdienstleistern halten uns im einfachsten PCI-Umfang (SAQ A, die leichteste Prüfstufe des Kartenindustrie-Standards).
7. **Deutsche Pflichten als Funktionen einplanen.** Grundpreis, Button „zahlungspflichtig bestellen“, Widerruf, Impressum, Cookie-Einwilligung, Barrierefreiheit (BFSG) und später E-Rechnung sind keine Texte, sondern Datenfelder und Abläufe, die im Datenmodell vorgesehen sein müssen.

---

## 2. Die Systeme im Einzelnen

### 2.1 Shopify

**Kernidee der Architektur.** Shopify betreibt einen sehr großen Rails-Monolithen (Ruby on Rails). Er ist in Komponenten mit festen Grenzen geschnitten, die ein eigenes Werkzeug (Packwerk) überwacht: Ein Modul darf nur das aufrufen, was ein anderes Modul ausdrücklich als öffentliche Schnittstelle freigibt. Die Datenbank (MySQL) ist in „Pods“ aufgeteilt, in denen jeweils viele Shops liegen. Jede Tabelle trägt eine Shop-Kennung. Die Storefront (Auslieferung der Kundenseite) ist ein eigener, auf Geschwindigkeit getrimmter Dienst, getrennt vom Admin-Bereich. Zu prüfen: Details zu Pods und Storefront-Renderer stammen aus Shopifys Engineering-Blog und Vorträgen, nicht aus der aktuellen Recherche.

**APIs.** Es gibt zwei GraphQL-APIs. GraphQL ist eine Abfragesprache, bei der der Aufrufer genau angibt, welche Felder er haben will.
- **Admin API:** für Händler-Funktionen und Apps (Produkte, Bestellungen, Kunden).
- **Storefront API:** für Kundenseiten und eigene Frontends (Katalog, Warenkorb, Checkout-Start).

**Erweiterungsmodell.** Shopify trennt strikt „Kern“ von „Apps“:
- **Apps** laufen außerhalb von Shopify, sprechen über OAuth (ein Standard für zeitlich begrenzte, auf Berechtigungen beschränkte Zugriffe) mit der API und werden per Webhooks (automatische Benachrichtigungen bei Ereignissen) informiert.
- **Shopify Functions** sind kleine, eingeschränkte Programme (WebAssembly), die direkt im Shopify-Ablauf laufen, etwa für Rabattlogik, Versandoptionen oder Zahlungsarten. Sie sind sicher, weil sie in einer Sandbox laufen, also keinen Zugriff auf das System außerhalb ihres Auftrags haben.
- **Checkout Extensibility:** Der Checkout wird nicht mehr per freiem Code verändert (die alte checkout.liquid wurde abgeschafft), sondern durch festgelegte Erweiterungspunkte und UI-Extensions. Vorteil: Shopify kann den Checkout sicher, schnell und PCI-konform halten.

**Mandantenmodell.** Ein Shop ist die Mandanteneinheit. Händler mit mehreren Märkten nutzen „Markets“ (Länder- und Währungssteuerung) innerhalb eines Shops, Großkunden mit vielen Shops nutzen die Organisation darüber.

**Datenmodell (B2B und International).**
- Markets steuern Land, Sprache, Währung, Domain und Preise.
- Für B2B gibt es Companies (Firmen), Company Locations (Standorte), Contacts, Kataloge mit Preislisten, Zahlungsbedingungen, Mengenregeln und Staffelpreise. Welche Tarife B2B enthalten, hat sich 2025 geändert (zu prüfen).
- Produkt, Variante (z. B. Größe/Farbe), Inventory Item und Inventory Location (Lagerort) sind getrennte Objekte. Bestand wird pro Lagerort geführt.

**Sicherheit.** Shopify betreibt den Checkout selbst (PCI-DSS Level 1), prüft Webhooks per Signatur (HMAC), vergibt Apps nur die benötigten Berechtigungen („Scopes“), nutzt kurzlebige Session-Tokens und betreibt ein öffentliches Bug-Bounty-Programm. Pflicht-Webhooks für Datenschutzanfragen sind Teil des App-Vertrags.

**Editor.** Online Store 2.0 führte JSON-Templates ein: Jede Seite ist eine Liste von „Sections“ (Abschnitten), diese enthalten „Blocks“ (Bausteine) mit Einstellungen. Der Händler zieht sie im Theme-Editor per Drag-and-drop. Die neuere Theme-Familie „Horizon“ erlaubt verschachtelte Blocks, also Bausteine in Bausteinen. Der Code der Sections steckt im Theme (Liquid-Vorlagen), die Daten des Händlers stehen in JSON.

**KI.** Shopify Magic erzeugt Produkttexte, Bildbearbeitung und Antworten. Sidekick ist der Chat-Assistent im Admin-Bereich, der Fragen zu Verkaufsdaten beantwortet und Aufgaben im Shop ausführt. Der Funktionsumfang wurde 2025 und 2026 deutlich erweitert (zu prüfen, welche Fähigkeiten aktuell sind). Für uns zählt das Prinzip: Der Assistent arbeitet über dieselben Schnittstellen wie Apps.

**Was Shopify am besten kann:** radikale Trennung von Kern und Erweiterung, sicherer Checkout, Theme-Editor mit Sections/Blocks, riesiges App-Ökosystem.

### 2.2 Shopware 6

**Kernidee.** Eine PHP-Anwendung (Symfony-Framework) mit Vue-basiertem Admin. Alles ist eine „Entität“ in einem einheitlichen Datenmodell, das automatisch API, Suche und Übersetzungen bekommt (das „Data Abstraction Layer“). Der Kern ist Open Source (MIT-Lizenz), erweiterte Funktionen sind kostenpflichtig.

**APIs.**
- **Admin API:** für Verwaltung, OAuth2-geschützt, mit einer Sammelschnittstelle für große Importe (Sync-API).
- **Store API:** für Kundenseiten, erkennt Kunden über einen Kontext-Token. Sie ist die Grundlage der „Composable Frontends“ (eigene Storefront in Vue/Nuxt).

**Erweiterungsmodell.** Plugins greifen über Events, Dekoratoren (Überschreiben einzelner Dienste) und eigene Entitäten ein. Der Preis dafür: Plugins laufen im selben Prozess und können alles. Eine Sandbox wie bei Shopify Functions gibt es nicht. Zusätzlich gibt es „Apps“, die extern laufen und per Webhook angebunden sind.

**Mandanten- und Kanalmodell.** Der zentrale Begriff ist der **Sales Channel** (Verkaufskanal). Jeder Kanal hat eigene Domains, Sprachen, Währungen, Zahlungs- und Versandarten, Kategoriebaum-Einstiegspunkt und Kundengruppen. Echte Mehrmandantenfähigkeit (viele fremde Händler in einer Installation) gehört nicht zum Kern, in der Praxis läuft pro Händler eine eigene Installation.

**Regelwerk.** Der **Rule Builder** erlaubt Händlern, Bedingungen ohne Code zu klicken („Kundengruppe = Händler UND Warenkorb > 500 €“). Dieselben Regeln steuern Preise, Versandkosten, die Sichtbarkeit von Zahlungsarten und Abläufe im **Flow Builder** (Ereignis, dann Aktionen, etwa „Bestellung bezahlt, dann Mail senden“). Das ist ein sehr gutes Vorbild: eine einzige, wiederverwendbare Regel-Sprache an vielen Stellen.

**Editor.** Die **Shopping Experiences** sind ein Seiteneditor aus Layout, Abschnitten, Blöcken und Elementen. Layouts lassen sich Kategorien, Produkten oder Landingpages zuweisen, und Elemente können Daten dynamisch aus dem Katalog ziehen.

**Datenmodell.** Preise liegen als Preisregeln an Produkten (je Regel, Währung, Staffel), Steuern als Steuersätze mit Ländervorgaben, Varianten über Eigenschaften, Bestand pauschal am Produkt (Mehrlager nur über Erweiterungen). Das zeigt, was man nicht kopieren sollte: Bestand pro Lagerort sollte von Anfang an eingeplant sein.

**B2B.** Die B2B Components (kostenpflichtig) ergänzen Firmenkonten mit Mitarbeitern und Rollen, Freigabe-Workflows, Schnellbestellung und Bestelllisten, plus Angebote.

**KI.** Der AI Copilot erzeugt unter anderem Produkttexte, Übersetzungen, Bild-Tags und Bewertungszusammenfassungen. Er ist eher „Hilfe im Formular“ als ein Assistent, der den ganzen Shop bedient (zu prüfen, aktueller Stand).

**Sicherheit.** Gängige Symfony-Praktiken (CSRF-Schutz, Passwort-Hashing), regelmäßige Sicherheitsupdates, Rechte-System im Admin. Plugin-Code ist die größte Angriffsfläche.

**Was Shopware am besten kann:** Regel- und Flow-Builder, Erlebniswelten-Editor, starke deutsche Rechtsfunktionen (viele Pflichtangaben sind eingebaut), sehr gutes B2B-Funktionsangebot.

### 2.3 commercetools

**Kernidee (MACH).** MACH steht für Microservices, API-first, Cloud-native, Headless. Gemeint ist: Es gibt keine mitgelieferte Storefront und keinen Admin-Look, sondern nur Bausteine hinter APIs (Katalog, Warenkorb, Bestellung, Preise, Kunden). Man setzt daraus ein eigenes System zusammen („composable“). commercetools ist von Haus aus ein Multi-Mandanten-SaaS: Ein „Project“ ist ein Mandant mit strikt getrennten Daten.

**Erweiterungsmodell.**
- **API Extensions:** synchrone Einhaker, die vor dem Speichern z. B. eine Bestellung prüfen oder verändern.
- **Subscriptions:** asynchrone Nachrichten bei Ereignissen.
- **Custom Types / Custom Objects:** Zusatzfelder an fast allen Objekten, ohne das Schema zu ändern.
- **Connect:** Hosting kleiner Integrationen.

**Mandanten- und Kanalmodell.**
- **Project** = Mandant.
- **Store** = ein Shop innerhalb des Projekts, mit eigenen Sprachen, Ländern, Produktauswahl und Verteilkanälen.
- **Channel** = ein Preis- oder Lagerkontext (z. B. ein physischer Standort oder ein Preisbereich).
- **Business Unit** (B2B) = Firma oder Abteilung in einer Hierarchie, mit „Associates“ (Mitarbeitern) und Rollen mit Berechtigungen. Das ist das ausgereifteste B2B-Rollenmodell der Branche.

**Preismodell (offiziell belegt).** Ein Preis gehört zu einer Variante (SKU) und einer Währung. Sein Geltungsbereich („Scope“) kann zusätzlich Land, Kundengruppe und Kanal enthalten, plus einen Gültigkeitszeitraum. Pro Scope darf es nur einen Preis geben. Bei der Preisauswahl prüft das System acht Kombinationen in fester Rangfolge: Kundengruppe+Kanal+Land, dann Kundengruppe+Kanal, Kundengruppe+Land, nur Kundengruppe, Kanal+Land, nur Kanal, nur Land und zuletzt „ohne Scope“. Zeitlich begrenzte Preise haben Vorrang, bei mehreren Treffern gewinnt der günstigste. Staffelpreise (Mengenrabatte) gelten für die gesamte Zeilenmenge, sobald die Mindestmenge erreicht ist. Preise können eingebettet (in der Variante) oder eigenständig (eigene Ressource, per SKU verknüpft) sein, eigenständige Preise sind für große Preislisten gedacht.

**Weitere Datenentscheidungen.** Steuerkategorien mit länderspezifischen Sätzen, Preise brutto oder netto je Steuermodus, Lagerbestand je Kanal (Supply Channel), Produkt/Variante strikt getrennt, alle Texte lokalisierbar (Map aus Sprache zu Text).

**Sicherheit.** OAuth2 mit Scopes pro Projekt, granulare API-Clients, Audit-Funktionen, Zertifizierungen (z. B. ISO 27001, SOC 2, PCI).

**Editor / KI.** commercetools liefert keinen Storefront-Editor, den ergänzt man mit Partnern. KI kommt über Werkzeuge für Produktdaten und Agenten-Schnittstellen (zu prüfen).

**Was commercetools am besten kann:** das Preis- und B2B-Datenmodell. Für uns die wichtigste Quelle für das Schema.

### 2.4 Medusa.js v2

**Kernidee.** Ein TypeScript/Node-Framework mit PostgreSQL. Die Architektur ist in Schichten aufgebaut: HTTP-Routen rufen **Workflows** auf (mehrstufige Abläufe mit Rückgängig-Schritten, wenn etwas schiefgeht), Workflows nutzen **Module** (abgeschlossene Domänen wie Produkt, Preis, Lager, Warenkorb), Module greifen auf die Datenbank zu. Weitere Infrastrukturmodule decken Events, Cache, Dateispeicher, Benachrichtigungen und Sperren ab und sind austauschbar (z. B. Redis oder lokal).

**Erweiterungsmodell.** Eigene Module, Workflows, Subscribers (reagieren auf Ereignisse), API-Routen und Admin-Erweiterungen, alles bündelbar zu Plugins. Zwischen Modulen gibt es keine direkten Datenbankverbindungen. Beziehungen werden über **Module Links** hergestellt. Dadurch könnte man ein Modul später in einen eigenen Dienst auslagern. Das ist genau das Muster, das wir wollen.

**Mandanten- und Kanalmodell.** Sales Channels (Verkaufskanäle) steuern, welche Produkte, Preise und Lager wo gelten. Echte Mehrmandantenfähigkeit gehört nicht zum Kern: Eine Instanz bedient einen Shop-Betreiber, viele Händler heißt viele Instanzen (oder eine eigene Eigenentwicklung darüber). Zu prüfen: wie weit sich das in der aktuellen Version durch Module/Plugins lösen lässt. Für uns heißt das: Medusa taugt als Vorbild und Ideenspender, aber nicht als fertiges Fundament für eine Plattform mit vielen Händlern.

**Datenmodell.** Price Sets und Price Lists mit Regeln (Währung, Region, Kundengruppe, Menge), Regionen mit Währung und Steuerregeln, Varianten mit Optionen, Inventory Items mit Stock Locations (Lagerorten) und Reservierungen. Das ist ein modernes, sauberes Modell.

**Editor / KI.** Kein eingebauter Storefront-Editor, Storefront ist ein frei wählbares Frontend (Next.js-Starter). KI-Funktionen sind Sache der Community.

**Was Medusa am besten kann:** Module + Workflows in TypeScript. Sehr gute Vorlage für unsere Code-Struktur.

### 2.5 Saleor

**Kernidee.** Python/Django, GraphQL als einzige API, strikt headless (keine Storefront-Pflicht), PostgreSQL. BSD-Lizenz.

**Kanalmodell.** Ein **Channel** ist die zentrale Einheit: Er hat eine eigene Währung, ein Land, Preise, Verfügbarkeit von Produkten, Lagerzuordnung (Warehouses), Steuer- und Zahlungskonfiguration und Checkout-Einstellungen. Produkte werden pro Kanal veröffentlicht, Varianten haben pro Kanal einen eigenen Preis. Für mehrere Händler gilt wie bei Medusa: Saleor Cloud trennt Mandanten durch eigene Umgebungen, nicht durch Zeilen in einer gemeinsamen Datenbank.

**Erweiterungsmodell.** Saleor Apps sind externe Dienste, die per Webhook (synchron oder asynchron) angesprochen werden und eine eigene Oberfläche per Dashboard-Einbettung mitbringen. Der Kern bleibt schlank, Zahlungsanbieter, Steuerberechnung (z. B. Avalara), Suche und E-Mail sind Apps. Webhooks werden signiert, damit der Empfänger die Echtheit prüfen kann.

**Datenmodell.** Product Types definieren, welche Attribute ein Produkt hat (Pflicht, Auswahl, Varianten-Achsen). Das ist eine gute Lösung für flexible Produktdaten ohne Schemaänderung. Mehrere Lager mit Zuweisung zu Kanälen sind eingebaut.

**Editor / KI.** Der Dashboard-Admin ist ein Frontend auf der GraphQL-API. Seitenaufbau ist rudimentär (Pages/Menüs), Storefront-Editoren kommen von Drittanbietern.

**Was Saleor am besten kann:** der Kanal-Begriff als Grundbaustein, Apps/Webhooks als Erweiterungsmodell.

### 2.6 Vendure

**Kernidee.** TypeScript, NestJS, GraphQL (Shop API und Admin API), Datenbank über TypeORM (PostgreSQL möglich). Plugins sind NestJS-Module und dürfen praktisch alles erweitern (eigene Entitäten, API-Felder, Jobs, Admin-UI-Teile).

**Mandanten- und Kanalmodell (offiziell belegt).** Vendure beschreibt Channels als Mittel, „mehrere Storefronts, Währungen und Verkäufer aus einer Instanz“ zu betreiben. Ein Channel hat Standardwährung, Standard-Steuerzone, Sprachen und einen Token, mit dem Anfragen dem Kanal zugeordnet werden. Produkte, Preise, Lagerorte, Zahlungs- und Versandmethoden, Rollen und mehr sind kanalbezogen. Das reicht für Multi-Store und Marktplätze. Es ist aber keine harte Datenisolation wie bei Row-Level-Security, da alle Daten in denselben Tabellen und derselben Anwendung liegen. Für fremde, einander misstrauende Händler wäre zusätzliche Absicherung nötig.

**Plugin-System.** Plugins deklarieren ihre Abhängigkeiten, Konfiguration und Erweiterungen an einem Ort. Lifecycle-Hooks, Event-Bus und Job-Queue sind eingebaut. Das ist ein gutes Beispiel, wie man Erweiterbarkeit in einem NestJS-Monolithen sauber organisiert.

**Datenmodell.** Product, ProductVariant mit Preisen je Kanal und Währung, Stock Locations, Tax Categories und Tax Zones, Customer Groups, Promotions. Mehrwährung ist eingebaut, die Steuerzone entscheidet, ob Preise brutto oder netto gelten.

**Editor / KI.** Kein Storefront-Editor, KI nur über Plugins.

**Was Vendure am besten kann:** TypeScript-Stack, der unserem Wunsch-Stack am nächsten kommt, saubere Plugin-Architektur.

### 2.7 ePages Now / ePages Base (Einordnung für Einsteiger)

ePages ist ein deutscher Anbieter von Shop-Software als Dienst (SaaS) für kleine Händler. ePages Base ist die ältere Produktlinie, ePages Now die neuere Generation, auf die bestehende Händler umgestellt wurden. Nach öffentlichen Angaben bekommen Händler dabei Shop, Hosting, Zahlungsarten, rechtliche Texte und Support aus einer Hand. Der Ansatz heißt „alles in einem Paket“: wenig Konfiguration, feste Vorlagen, deutsche Rechtstexte und Support. Es gibt eine Schnittstelle (REST-API) und auch eine Anbindung für KI-Assistenten (ein MCP-Zugang zu Shops, der Produkte, Kategorien, Bestellungen, Rechtstexte und Umsatzwerte lesen und – wenn der Händler es freischaltet – ändern kann).

Was Einsteiger von so einem System erwarten und was wir daraus lernen:
- **Schnell startklar, ohne Technik.** Wizard statt Einstellungsflut.
- **Rechtssicherheit eingebaut.** Impressum, AGB, Widerruf, Datenschutz als Assistent mit Vorlagen.
- **Wenige, gut gewählte Optionen** statt Baukasten mit tausend Schaltern.
- **Schreibrechte für KI sind standardmäßig aus** und müssen vom Händler pro Shop eingeschaltet werden. Dieses Muster übernehmen wir (siehe Abschnitt 4).

Zu prüfen: aktuelle Preis- und Funktionsstufen der ePages-Pakete, dazu habe ich keine belastbare Quelle gefunden.

---

## 3. Vergleich auf einen Blick

| Thema | Shopify | Shopware 6 | commercetools | Medusa v2 | Saleor | Vendure |
|---|---|---|---|---|---|---|
| Grundform | Modularer Monolith (Ruby) | Monolith (PHP) | Microservices als SaaS | Modularer Monolith (TypeScript) | Monolith (Python), headless | Monolith (TypeScript, NestJS) |
| API | GraphQL (Admin, Storefront) | REST (Admin, Store) | REST + GraphQL | REST | GraphQL | GraphQL |
| Erweiterung | Apps, Functions (Sandbox), UI-Extensions | Plugins, Apps | Extensions, Subscriptions, Custom Types | Module, Workflows, Plugins | Apps + Webhooks | Plugins (NestJS) |
| Mehrere Händler in einer Instanz | Ja (Plattform) | Nein, eine Installation pro Händler | Ja (Project) | Nein, eine Instanz pro Betreiber | Nein, eine Umgebung pro Mandant | Teilweise (Channels, ohne harte Isolation) |
| Kanal-/Store-Begriff | Markets | Sales Channel | Store + Channel | Sales Channel, Region | Channel | Channel |
| Preise je Kanal/Währung/Kundengruppe | Ja (Kataloge, Markets) | Ja (Preisregeln) | Ja (Scope-Modell) | Ja (Price Sets/Lists) | Ja (je Channel) | Ja (je Channel+Währung) |
| B2B-Modell | Company, Location, Katalog | B2B Components (kostenpflichtig) | Business Unit, Associates | Eigenbau/Module | Eigenbau/Apps | Eigenbau/Plugins |
| Lager je Standort | Ja | Eingeschränkt | Ja | Ja | Ja | Ja |
| Visueller Editor | Sections/Blocks (stark) | Erlebniswelten (stark) | Nein | Nein | Nein | Nein |
| KI-Funktionen | Magic, Sidekick | AI Copilot | Agenten-Schnittstellen | Community | Community | Community |
| Lizenz | Geschlossen | MIT (Kern) | Geschlossen | MIT | BSD | MIT (Kern) |

Ergebnis: **Kein System deckt unsere Kombination aus echter Mehrmandantenfähigkeit, freiem Stack und Editor ab.** Deshalb übernehmen wir Ideen, nicht Code.

---

## 4. Was wir übernehmen

### 4.1 Architekturregeln ab Tag 1

1. **Modularer Monolith mit harten Grenzen** (Vorbild: Shopify Packwerk, Medusa Module). Jedes Modul besitzt seine Tabellen. Andere Module greifen nie direkt auf fremde Tabellen zu, sondern nur über die öffentliche Schnittstelle des Moduls oder über Ereignisse. Ein automatischer Prüfer im Build (z. B. dependency-cruiser oder ESLint-Regeln) bricht ab, wenn jemand die Grenze verletzt.
2. **Vorgeschlagene Module:** `tenancy` (Plattform, Händler, Shops), `identity` (Anmeldung, Rollen), `catalog` (Produkte, Varianten, Kategorien), `pricing` (Preise, Preislisten), `tax` (Steuern), `inventory` (Bestand, Lagerorte), `cart` (Warenkorb), `checkout`, `orders`, `payments` (Anbindung gehosteter Zahlungsarten), `fulfillment` (Versand), `customers`, `content` (Seiten, Editor), `media` (Bilder), `legal` (Rechtstexte, Einwilligungen), `notifications` (E-Mails), `audit` (Protokoll), `ai` (Assistent und Werkzeuge).
3. **Workflows statt verstreuter Logik** (Vorbild: Medusa). Mehrstufige Vorgänge wie „Bestellung aufgeben“ sind benannte Abläufe mit Kompensation (Rückgängigmachen), nicht Verkettungen von Zufallsaufrufen.
4. **Ereignisse über das Outbox-Muster:** Ein Ereignis wird in derselben Datenbank-Transaktion wie die Änderung in eine Tabelle geschrieben und danach zuverlässig verteilt. So gehen keine Ereignisse verloren, und Module lassen sich später als Dienste herauslösen.
5. **Zwei Erweiterungsstufen** (Vorbild: Shopify): (a) Webhooks und API für externe Apps, (b) kleine, sandboxed Regeln für Preis-, Versand- und Rabattlogik. Wir bauen einen **Regelmotor** (Vorbild: Shopware Rule Builder) mit einer einzigen Regelsprache, die später Rabatte, Versandarten, Zahlungsarten und Kundengruppenzuordnung steuert. Regeln sind Daten (JSON), kein ausführbarer Code.
6. **API zuerst:** Eine OpenAPI-Beschreibung (maschinenlesbarer Katalog aller Endpunkte) ist die Quelle der Wahrheit. Aus ihr entstehen automatisch Dokumentation, Typen für die Frontends und die KI-Werkzeuge. Admin-API und Storefront-API sind getrennt (Vorbild: Shopify, Shopware) mit unterschiedlichen Rechten und Rate-Limits. Versionierung ab dem ersten Tag (z. B. `/v1`).
7. **Kein UI im Kern:** Backoffice und Storefront sind gewöhnliche Clients der API.

### 4.2 Datenmodell-Entscheidungen, die B2B und International offen halten

| Bereich | Entscheidung | Vorbild |
|---|---|---|
| Mandant | Jede Tabelle hat `tenant_id` (Händler) und, wo sinnvoll, `shop_id`. IDs als UUIDv7 (zeitlich sortierbar, nicht erratbar). | Shopify, Postgres RLS |
| Geld | Beträge als ganze Zahlen in der kleinsten Einheit (Cent) plus Währungscode, nie als Kommazahl. Rundungsregel pro Währung gespeichert. | commercetools, Medusa |
| Kanal | Eigene Tabelle `sales_channel`: Shop, Land/Markt, Währung, Sprache(n), Steuermodus (brutto/netto), Domain. Produkte werden pro Kanal veröffentlicht. | Saleor, Vendure |
| Produkt | Trennung `product` (Beschreibung) und `variant` (kaufbare Einheit/SKU). Varianten-Achsen (Größe, Farbe) über `product_type`/Attribute. Einfache Produkte haben genau eine Variante. | Saleor, Medusa, Shopify |
| Preise | Eigene Tabelle `price`: Variante, Währung, Betrag, optional Kanal, Kundengruppe, Land, Mindestmenge, gültig von/bis. Preisauswahl nach fester Rangfolge, die genau so dokumentiert und getestet ist wie bei commercetools. Eine „Standardpreis“-Zeile ohne Scope ist der Rückfall. | commercetools |
| Kundengruppen | Tabelle `customer_group` plus Zuordnung, von Anfang an auch für Firmen nutzbar. | commercetools, Shopware |
| B2B-Struktur | Tabellen `company` und `company_member` (mit Rolle) bereits anlegen, auch wenn Welle 1 sie nicht nutzt. Bestellung hat optional `company_id`. Zahlungsbedingungen und Mengenregeln als spätere Felder. | commercetools Business Unit, Shopify Company |
| Steuern | `tax_category` am Produkt, `tax_rate` je Land/Region und Kategorie mit Gültigkeitszeitraum. Auf Positionen werden Satz und Betrag gespeichert (Momentaufnahme). Brutto/Netto je Kanal. Steuerbefreiungen (z. B. innergemeinschaftlich mit USt-IdNr.) als Regelfall vorsehen. | commercetools, Vendure |
| Bestand | `stock_location` (Lagerort), `stock_level` je Variante und Ort, `reservation` für Warenkörbe und offene Bestellungen. Bestandsbewegungen als Protokoll (nur anhängen), nicht nur eine Zahl. | Shopify, Medusa |
| Sprachen | Übersetzbare Texte in eigenen Übersetzungstabellen mit Sprachcode und Rückfallsprache. Nie „Titel“ und „Titel_EN“ als Spalten. Slugs (URL-Namen) je Sprache. | Shopware, Saleor |
| Bestellung | Unveränderliche Momentaufnahme: Adressen, Preise, Steuern, Rechtstextversionen und Zahlungsart werden in die Bestellung kopiert. Änderungen später als Korrekturbelege. Fortlaufende, lückenlose Belegnummern pro Händler. | Buchführungspflicht (GoBD) |
| Zusatzfelder | Kontrolliert erweiterbare Felder (JSONB mit hinterlegtem Schema je Mandant) an Produkten, Kunden, Bestellungen. | commercetools Custom Types |
| Löschen | Weiche Löschung plus Aufbewahrungsfristen. Personenbezogene Daten lassen sich pseudonymisieren, ohne Buchungsbelege zu zerstören. | DSGVO + HGB/AO |
| Mengeneinheit | Inhalt, Einheit und Bezugsgröße je Variante für den Grundpreis (z. B. 500 g, Bezug 1 kg). | PAngV |
| Rechtstexte | Versionierte Rechtstexte (AGB, Widerruf, Datenschutz) je Shop und Sprache. Bestellung speichert, welche Version bestätigt wurde. | Rechtspflicht |

### 4.3 Mandantentrennung (Mehrmandantenfähigkeit)

- **Modell:** ein gemeinsames Datenbankschema, `tenant_id` in jeder Tabelle, **Row-Level-Security** in PostgreSQL. Die Anwendung setzt pro Anfrage innerhalb der Transaktion `SET LOCAL app.tenant_id = '...'`, und die Policies lauten sinngemäß `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- **Wichtige Details:** Die Anwendung verbindet sich mit einem Datenbankbenutzer **ohne** Superuser- und ohne BYPASSRLS-Recht. Auf jeder Tabelle `ENABLE` und `FORCE ROW LEVEL SECURITY`. Ein automatischer Test legt zwei Testmandanten an und prüft bei jeder Tabelle, dass Mandant A keine Zeile von Mandant B sieht oder ändert. Eine Linie im Build bricht ab, wenn eine neue Tabelle keine Policy hat.
- **Plattform-Admin:** eigene Datenbankrolle und eigener, streng begrenzter Code-Pfad mit Protokollierung („Impersonation“ nur mit Grund und Zeitlimit).
- **Ausstiegsoption:** Weil `tenant_id` überall steht, kann ein großer Händler später in ein eigenes Schema oder eine eigene Datenbank umziehen (Silo-Modell).
- **Auch außerhalb der Datenbank trennen:** Objektspeicher-Pfade (`/tenant/<id>/...`), Such-Indizes, Caches (Schlüssel mit Mandant), Warteschlangen-Jobs (Mandant im Job), Logs (Mandant als Feld).

### 4.4 Visueller Storefront-Editor

- **Datenmodell wie bei Shopify:** `theme` enthält Vorlagen, Vorlagen enthalten geordnete `sections`, Sections enthalten `blocks`, alle mit `type`, `settings` (JSON) und Einstellungsschema. Sections werden von der Plattform bereitgestellt, nicht frei vom Händler als Code hochgeladen.
- **Sicherheit:** Händler können Texte, Bilder, Farben, Anordnung ändern. Eigenes HTML/JavaScript gibt es zunächst nicht (verhindert Cross-Site-Scripting und gestohlene Zahlungsdaten). Eingebettete Inhalte nur aus einer Liste erlaubter Quellen.
- **Entwurf und Veröffentlichung:** Jede Seite hat Entwurf und veröffentlichte Version (Versionierung, Zurück-Button).
- **Rendering:** Storefront rendert die Struktur serverseitig und liefert sie zwischengespeichert aus. Der Editor ist eine Vorschau mit Bearbeitungsrahmen im selben Renderer („was du siehst, ist was der Kunde sieht“).
- **KI-tauglich:** Weil die Seite aus JSON besteht, kann der Assistent „Baue mir eine Startseite mit Hero-Bild und drei Produkten“ als Änderung der Struktur ausführen, die der Händler vorher in der Vorschau sieht.

### 4.5 KI-first

- **Prinzip:** Der Assistent hat keine Sonderrechte. Er nutzt dieselben API-Funktionen wie das Backoffice, über einen MCP-Server, der aus der OpenAPI-Beschreibung erzeugt und von Hand veredelt wird. Vorbild: Shopify Sidekick (Aktionen im Admin) und der MCP-Zugang von ePages.
- **Rechte:** Der Assistent läuft im Namen des angemeldeten Händlers mit genau dessen Rechten. Schreibzugriff ist je Shop abschaltbar (Standard: aus, wie bei ePages), Löschen und Preis-/Steueränderungen verlangen eine Bestätigung durch den Händler.
- **Vorschau vor Wirkung:** Der Assistent erzeugt einen Änderungsvorschlag („Ich lege 12 Produkte an, hier die Liste“), der Händler bestätigt. Massenänderungen sind rückgängig machbar.
- **Produktbilder:** Upload per Chat, Speicherung im Objektspeicher, Aufbereitung in einer Bildverarbeitung (Zuschnitt, Größen, WebP/AVIF), optional Hintergrund entfernen mit einem offenen Modell. Der Assistent liest das Bild (Bilderkennung durch das Sprachmodell), schlägt Titel, Beschreibung und Alt-Text vor. Der Alt-Text ist zugleich Barrierefreiheit (BFSG).
- **Schutz vor Manipulation:** Texte aus Kundennachrichten, Produktbeschreibungen oder Bildern sind Daten und niemals Anweisungen. Der Assistent darf aus solchem Inhalt keine Aktionen ableiten (Schutz gegen „Prompt Injection“, also eingeschleuste Befehle in Texten).
- **Protokoll:** Jede KI-Aktion landet im Audit-Log mit Kennzeichnung „durch Assistent ausgelöst“.
- **Disclaimer zu Kosten:** Das Sprachmodell selbst ist ein kostenpflichtiger Dienst. „Nur freie Software“ gilt für unseren Code und unsere Infrastruktur. Das Modell hinter dem Assistenten muss austauschbar sein (Schnittstelle), damit später auch ein selbst gehostetes offenes Modell möglich ist.

### 4.6 Empfohlener freier Tech-Stack

Bewertung: 1 = beste Eignung für unser Vorhaben, 9 = schlechteste.

| Baustein | Empfehlung | Begründung | Bewertung | Alternative |
|---|---|---|---|---|
| Sprache | **TypeScript** (Node.js, LTS) | Eine Sprache für Backend, Storefront und Editor. Typen helfen der KI, Fehler früh zu finden. Riesige Bibliothekswelt. | 2 | Python (Django), PHP (Symfony) |
| Backend-Framework | **NestJS** auf **Fastify** | NestJS erzwingt Module, Abhängigkeitsinjektion und Schichten, was zum modularen Monolithen passt (Vendure nutzt es ebenfalls). Fastify ist schnell. | 2 | Reines Fastify (flexibler, aber mehr Disziplin nötig, Bewertung 4) |
| Datenbank | **PostgreSQL** | Row-Level-Security, JSONB, Volltextsuche, Transaktionen, bewährt. | 1 | – |
| Datenzugriff | **Drizzle ORM** oder **Kysely** (SQL-nah), Migrationen als Dateien | Mit RLS und „SET LOCAL“ pro Transaktion gut kombinierbar. Prisma macht das schwerer. | 3 | Prisma (4), TypeORM (5) |
| API-Stil | **REST mit OpenAPI** für Admin und Storefront | Einfach zu testen, Tooling für Typen und MCP-Erzeugung. GraphQL nur, wenn ein klarer Bedarf entsteht. | 3 | GraphQL (3) |
| Anmeldung | **OIDC/OAuth2-Standard**; Start mit **Better Auth** oder **Keycloak** | Passkeys/2FA, getrennte Bereiche für Plattform-Admin, Händler, Kunden. Keycloak ist mächtig, aber schwer, Better Auth ist leicht eingebaut. Standardprotokolle halten den Wechsel offen. | 3 | Ory, Zitadel, Authentik |
| Warteschlange | **pg-boss** (läuft in PostgreSQL) | Eine Komponente weniger im Betrieb. Später bei Bedarf BullMQ mit Valkey (freier Redis-Nachfolger). | 3 | BullMQ + Valkey (4) |
| Objektspeicher | **S3-kompatible Schnittstelle**, Server austauschbar: **Garage** oder **SeaweedFS**; MinIO nur nach Lizenzprüfung | MinIO ist AGPL und hat seine Community-Ausgaben 2025 deutlich eingeschränkt (zu prüfen, aktueller Stand). Die S3-Schnittstelle als Abstraktion macht die Wahl unkritisch. | 3 | MinIO (5) |
| Suche | **PostgreSQL-Volltextsuche** zum Start, später **Meilisearch** (MIT) | Meilisearch ist schnell, tippfehlertolerant, hat mandantenbezogene Suchschlüssel. Für Welle 1 reicht Postgres. | 3 | OpenSearch (6) |
| Cache | Valkey bei Bedarf | Nicht von Anfang an nötig. | 5 | – |
| Storefront | **Next.js** (React, MIT) oder **Astro** | Serverseitiges Rendern für SEO und Geschwindigkeit, Zwischenspeicherung, Mehrsprachigkeit. Eigener Renderer für Editor-Struktur. | 3 | SvelteKit (4), Nuxt (4) |
| Backoffice-UI | **React** (Vite) mit **shadcn/ui** und **Radix** | Barrierefreie Bausteine, schnell zu bauen. | 3 | Vue (4) |
| Reverse-Proxy/TLS | **Caddy** | Automatische Zertifikate, auch für eigene Händler-Domains („On-Demand TLS“). | 2 | Traefik, Nginx |
| Betrieb | **Docker Compose** zum Start, Helm/Kubernetes später | Überall selbst hostbar (Anforderung). | 2 | – |
| Geheimnisse | Umgebungsvariablen aus **SOPS/age**-verschlüsselten Dateien, später **OpenBao** (freier Vault-Fork) | Keine Passwörter im Code. | 3 | – |
| Beobachtbarkeit | **OpenTelemetry**, Prometheus, Grafana, Loki | Freie Standards. | 4 | – |
| Zahlung | **Mollie, Stripe, PayPal** als gehostete Bezahlseiten | Dienste sind kostenpflichtig (Transaktionsgebühren), aber ohne eigene Kartendaten. Eine freie Alternative ohne Dienstleister gibt es für Kartenzahlung praktisch nicht. | 2 | – |
| PDF/E-Rechnung | Bibliotheken für ZUGFeRD/XRechnung (z. B. Mustang, Java, als Hilfsdienst) | Spätere Welle, vorbereiten. | 4 | – |
| Tests | Vitest, Playwright, Mandanten-Isolationstest | Ohne Tests kann die KI nicht sicher ändern. | 1 | – |

**Hinweis zur Zusammenarbeit mit der KI:** Als Nicht-Entwickler sollten Sie die Qualitätssicherung in den Build legen: Typprüfung, Linting, Architektur-Grenzprüfung, Mandanten-Isolationstests, Abhängigkeits-Scan und automatische Tests laufen bei jeder Änderung (CI). So bleibt der von der KI geschriebene Code überprüfbar.

---

## 5. Sicherheits-Grundlagen für eine mandantenfähige Shop-Plattform

| Thema | Was konkret zu tun ist |
|---|---|
| **OWASP Top 10 und ASVS** | OWASP Top 10 ist die Liste der häufigsten Webschwachstellen, ASVS (Application Security Verification Standard) ist eine Prüfliste dazu. Wir nehmen ASVS Level 2 als Zielbild und arbeiten die Punkte pro Welle ab. |
| **Zugriffskontrolle (Broken Access Control)** | Platz 1 bei OWASP und bei Shop-Plattformen das Hauptrisiko. Jede Abfrage prüft Mandant (RLS) und Recht. Objekt-IDs sind nie alleiniger Schutz (IDOR-Test: Kann Händler A die Bestellung von Händler B über deren ID abrufen?). |
| **Mandantentrennung** | RLS wie in 4.3, dazu Isolationstest im Build, getrennte Pfade, Caches und Indizes je Mandant. |
| **Eingaben und Ausgaben** | Alle Eingaben mit Schemaprüfung (z. B. Zod/TypeBox). Parametrisierte SQL-Abfragen (kein String-Zusammenbau). Ausgaben im Frontend automatisch maskiert. Eine Content-Security-Policy (Browser-Regel, welche Skripte laufen dürfen). |
| **Anmeldung** | Passwörter mit Argon2id, 2FA/Passkeys für Händler und Admins verpflichtend, Sperre nach Fehlversuchen, kurzlebige Tokens, sichere Cookies (HttpOnly, Secure, SameSite). Plattform-Admin nur mit starker 2FA. |
| **Rechte** | Rollen und Berechtigungen pro Händler (Inhaber, Mitarbeiter, nur lesen) nach dem Prinzip „so wenig wie nötig“. API-Schlüssel mit Scopes (Vorbild: Shopify). |
| **PCI-Umfang klein halten** | Zahlungsseite gehostet beim Zahlungsdienstleister (Weiterleitung oder eingebettetes Feld des Anbieters). Wir speichern und verarbeiten keine Kartennummern. Ziel: SAQ A. Eigene Skripte auf der Bezahlseite vermeiden und die Content-Security-Policy dort besonders streng setzen. Webhooks der Zahlungsanbieter nur mit geprüfter Signatur akzeptieren. |
| **Geheimnisse** | Keine Schlüssel im Code oder Git. Verschlüsselte Ablage, Rotation, Zugangsdaten der Händler (z. B. eigene Zahlungs-Schlüssel) verschlüsselt in der Datenbank (Envelope Encryption: Daten-Schlüssel, die selbst durch einen Hauptschlüssel geschützt sind). |
| **Rate Limiting** | Begrenzung der Anfragen pro IP, Konto, Mandant und Route (strenger bei Login, Passwort-Reset, Checkout, Gutscheincodes, Suche). Schutz vor „Credential Stuffing“ (massenhaftes Ausprobieren gestohlener Zugangsdaten) und vor einem lauten Mandanten, der andere ausbremst („Noisy Neighbour“). |
| **Audit-Log** | Nur anhängbares Protokoll: wer (Nutzer, Assistent, Plattform-Admin), was, wann, auf welchem Objekt, vorher/nachher, von welcher IP. Sicherheitsrelevante Ereignisse (Login, Rechteänderung, Export, Impersonation, Preis- und Steueränderungen) zwingend. Händler sehen ihr eigenes Log. |
| **Dateien und Bilder** | Upload nur erlaubter Typen, Größenlimit, Prüfung des tatsächlichen Dateiinhalts, Neuberechnung der Bilder (entfernt eingebettete Schadinhalte), Auslieferung von einer eigenen Domain. |
| **Server-Side Request Forgery (SSRF)** | Wenn Händler Webhook-URLs oder Bild-URLs angeben, darf der Server keine internen Adressen aufrufen. Erlaubnisliste und Blockade privater IP-Bereiche. |
| **Lieferkette** | Abhängigkeits-Scan (z. B. npm audit, Dependabot), Lock-Dateien, Container-Scan, SBOM (Liste aller Bestandteile). |
| **Daten und Backups** | Verschlüsselung bei Übertragung (TLS) und im Ruhezustand, regelmäßige Backups mit Wiederherstellungstest, Mandanten-Export und -Löschung. |
| **Datenschutz** | Auftragsverarbeitung: Für Händler sind wir Auftragsverarbeiter, es braucht einen AV-Vertrag (Vorlage). Datenminimierung, Löschkonzepte, Auskunfts- und Löschfunktionen. |
| **KI-spezifisch** | Schutz gegen Prompt Injection (siehe 4.5), Werkzeug-Rechte, Bestätigung bei gefährlichen Aktionen, keine Mandantendaten in Prompts anderer Mandanten, Protokoll. |
| **Betrieb** | Updates, Monitoring, Alarmierung, Vorfallplan (Meldepflicht bei Datenpannen binnen 72 Stunden nach DSGVO), Penetrationstest vor dem ersten echten Händler. |

---

## 6. Deutsche Pflichten, die der Shop technisch können muss

Disclaimer: Das ist eine technische Anforderungsliste auf Stand der Recherche und keine Rechtsberatung. Vor dem ersten echten Händler sollte eine Fachkanzlei (z. B. Händlerbund, IT-Recht Kanzlei) die Texte und Abläufe prüfen.

| Pflicht | Was technisch nötig ist | Welle |
|---|---|---|
| **Button-Lösung** (§ 312j BGB) | Der letzte Bestellschritt zeigt eine Zusammenfassung (Ware, Gesamtpreis, Lieferkosten, Lieferzeit) und einen Button, der eindeutig beschriftet ist, z. B. „zahlungspflichtig bestellen“. Der Text muss konfigurierbar sein, darf aber nicht ohne Zahlungshinweis geändert werden. | 1 |
| **Preisangaben / PAngV** | Preise inklusive Mehrwertsteuer (bei Verbrauchern), Hinweis „inkl. MwSt. zzgl. Versandkosten“ mit Link. **Grundpreis** (Preis je Kilogramm, Liter, Meter usw.) neben dem Gesamtpreis, wo vorgeschrieben (Felder: Inhaltsmenge, Einheit, Bezugsmenge). Bei Preisermäßigungen muss der niedrigste Preis der letzten 30 Tage als Vergleichswert angegeben werden, also braucht es eine **Preishistorie**. | 1 |
| **Widerruf** | Widerrufsbelehrung und Muster-Widerrufsformular im Checkout und in der Bestätigungsmail (als dauerhafter Datenträger, z. B. PDF/E-Mail). 14 Tage Frist, Ausnahmen je Produktart markierbar (z. B. individuell angefertigt, versiegelte Hygieneartikel). Die EU hat zusätzlich eine elektronische **Widerrufsfunktion** („Vertrag widerrufen“-Button) beschlossen, mit Geltung ab Juni 2026 (zu prüfen: deutsche Umsetzung und genaue Ausgestaltung). Wir planen deshalb einen Widerrufs-Vorgang im Kundenkonto und per Link ein. | 1 |
| **Impressum und Pflichtangaben** | Pflicht-Seite mit Anbieterkennzeichnung (§ 5 DDG), von jeder Seite mit höchstens zwei Klicks erreichbar. Felder: Name, Anschrift, Kontakt, Register, USt-IdNr. Ebenso Kontakt für Produktsicherheit (EU-Produktsicherheitsverordnung GPSR: Hersteller- und Verantwortlichen-Angaben je Produkt) und ggf. Hinweise zu Verpackungsregister (LUCID), Elektro- und Batteriegesetz. | 1 |
| **Datenschutzerklärung** | Vorlage je Shop, Liste der eingesetzten Dienste (Zahlung, Versand, Analyse), versioniert. Händler bleibt verantwortlich, wir liefern Generator und Hinweise. | 1 |
| **Cookie-Einwilligung** | Nicht notwendige Cookies und Tracker (Analyse, Marketing) erst nach aktiver Einwilligung (TDDDG § 25 und DSGVO). Banner mit gleichwertigen Schaltflächen „Alle akzeptieren“ und „Ablehnen“, Widerruf jederzeit möglich, Protokollierung der Einwilligung. Technisch notwendige Cookies (Warenkorb, Login) brauchen keine. Wir setzen standardmäßig kein Tracking ein, das erleichtert alles. | 1 |
| **AGB, Versand- und Zahlungsinfos** | Textbausteine, Lieferzeit je Produkt, Versandkostentabellen je Land, Pflichtangaben vor der Bestellung. AGB als versioniertes Dokument, Bestätigung im Checkout gespeichert. | 1 |
| **Bestellbestätigung** | Automatische E-Mail mit Bestellübersicht, AGB, Widerrufsbelehrung und Rechnung bzw. Beleg. | 1 |
| **Steuern** | Deutsche Sätze 19 % und 7 %, Kleinunternehmerregelung (§ 19 UStG, keine Steuerausweisung) als Händler-Einstellung, spätere EU-Regeln (OSS, One-Stop-Shop) vorbereitet durch Steuerzonen im Datenmodell. | 1 / später |
| **Barrierefreiheit (BFSG)** | Das Barrierefreiheitsstärkungsgesetz gilt seit **28. Juni 2025** für Online-Shops, die an Verbraucher verkaufen. Kleinstunternehmen (unter 10 Beschäftigte und höchstens 2 Mio. € Umsatz oder Bilanzsumme) sind für Dienstleistungen ausgenommen. Anforderungen: Orientierung an WCAG 2.1 AA bzw. EN 301 549 (Tastaturbedienung, Kontraste, Alt-Texte, Formularbeschriftung, Fehlermeldungen, Screenreader-Tauglichkeit), eine **Barrierefreiheitserklärung** im Shop. Für uns heißt das: barrierefreie Standard-Themes, automatische Prüfungen im Build (axe), Pflichtfeld für Alt-Texte, Kontrastprüfung im Editor. Die Plattform ist hier ein Verkaufsargument, weil Händler es sonst selbst lösen müssten. | 1 |
| **Aufbewahrung und Buchführung** | Rechnungen und Buchungsbelege unveränderbar speichern (GoBD), Aufbewahrungsfristen von 8 bzw. 10 Jahren je Belegart (zu prüfen: aktuelle Fristen), Exportformat für den Steuerberater (z. B. DATEV-CSV). | 2 |
| **E-Rechnung (ZUGFeRD / XRechnung)** | Seit 1.1.2025 müssen Unternehmen in Deutschland E-Rechnungen im B2B **empfangen** können. Das **Ausstellen** wird schrittweise Pflicht: Übergangsfrist bis Ende 2026, für Unternehmen mit mehr als 800.000 € Vorjahresumsatz ab 1.1.2027, für alle ab 1.1.2028. Das Format muss der Europäischen Norm EN 16931 entsprechen. ZUGFeRD ist ein PDF mit eingebetteten Strukturdaten, XRechnung ist eine reine XML-Datei. Wir planen die nötigen Felder (Käufer-Referenz „Leitweg-ID“, USt-IdNr., Zahlungsbedingungen, Steuerkategorie je Position) von Anfang an im Datenmodell. Die Erzeugung folgt in einer späteren Welle. Privatkundenverkäufe (B2C) sind von der Pflicht nicht erfasst. | 3 (B2B) |
| **Verbraucher-Streitbeilegung** | Hinweis, ob der Händler an einer Verbraucherschlichtung teilnimmt (VSBG). Die EU-OS-Plattform ist seit Juli 2025 abgeschaltet, der Link dazu wird nicht mehr verlangt (zu prüfen). | 1 |

Quellen und Zeitpunkte zu BFSG und E-Rechnung stammen aus IHK-Seiten, Kanzlei-Artikeln und Fachportalen (siehe Quellen). Termine für die E-Rechnung bitte vor Umsetzung noch einmal am Bundesfinanzministerium prüfen.

---

## 7. Empfohlene Reihenfolge (Wellen)

- **Welle 1 (Deutschland, einfache Produkte):** Plattform-Admin (Händler und Shops anlegen), Händler-Backoffice (Produkte, Bilder, Bestellungen), Storefront mit Katalog, Warenkorb, Checkout mit gehosteter Zahlung, Rechtstexte, Cookie-Banner, Barrierefreiheit, KI-Assistent für Produkte und Bilder (lesend und mit Bestätigung schreibend), Audit-Log, Isolationstests. **Datenmodell wie in 4.2 vollständig, aber nur die einfachen Teile bedient.**
- **Welle 2:** visueller Editor in voller Ausbaustufe, Varianten, Gutscheine und Regelmotor, Mehrlager, Versandarten pro Land, Meilisearch, DATEV-Export.
- **Welle 3:** B2B (Firmenkonten, Preislisten je Kundengruppe, Staffelpreise, Zahlungsziele, E-Rechnung), weitere Länder/Sprachen/Währungen (OSS-Steuern), Marktplatzfunktionen, App-Schnittstelle für Dritte.

---

## 8. Quellen

Aus der Recherche (abgerufen oder in den Suchergebnissen gefunden):
- Shopify Hydrogen und Composable Commerce: [Hydrogen: Shopify's headless commerce framework](https://www.cleverence.com/articles/shopify-dev-documentation/hydrogen-shopify's-headless-commerce-framework-4962), [Shopify Composable Commerce Guide](https://sam-solutions.com/blog/shopify-composable-commerce/), [Shopify Hydrogen Guide 2026](https://qualimero.com/en/blog/shopify-hydrogen), [Shopify Platform Architecture](https://tenten.co/shopifymcp/docs/course/shopify-fundamentals/platform-architecture)
- Shopify Horizon / Themes: [Shopify Horizon Themes Guide (2026)](https://ecommerce-platforms.com/articles/shopify-horizon-themes), [Horizon Themes 2026](https://gempages.net/de/blogs/shopify/shopify-horizon-themes)
- Shopware: [Shopware 6 Complete Guide](https://qualimero.com/en/blog/shopware-6), [Shopware B2B](https://qualimero.com/en/blog/shopware-b2b), [Shopware B2B vs B2C](https://qualimero.com/en/blog/shopware-b2b-vs-b2c)
- commercetools: [Pricing and discounts overview](https://docs.commercetools.com/api/pricing-and-discounts-overview), [Types of prices](https://docs.commercetools.com/learning-price-and-discount-your-products/price-calculation/types-of-prices.md), [Company-specific pricing](https://docs.commercetools.com/learning-model-b2b-commerce/configure-b2b-pricing/company-specific-pricing.md), [Uniform pricing with channels](https://docs.commercetools.com/learning-price-and-discount-your-products/set-static-prices/achieve-uniform-pricing-with-channels.md)
- Medusa: [Architecture](https://docs.medusajs.com/learn/introduction/architecture), [Store Module](https://docs.medusajs.com/resources/commerce-modules/store), [Sales Channel Module](https://docs.medusajs.com/modules/sales-channels/), [v2 release](https://medusajs.com/blog/v2-release)
- Saleor: [Saleor 3.0 Multichannel](https://saleor.io/blog/saleor-30-multichannel-extensibility-improvements), [Webhooks erstellen](https://docs.saleor.io/developer/extending/webhooks/creating), [Saleor Apps](https://www.github.com/saleor/apps)
- Vendure: [Channels](https://docs.vendure.io/current/core/core-concepts/channels)
- ePages: [Update von ePages Base zu ePages Now](https://blog.epages.com/de/?p=24945), [Update to ePages Now](https://update.epages.com/i/now), [OMR Reviews ePages](https://omr.com/de/reviews/product/epages/all)
- BFSG: [IHK Aschaffenburg](https://www.ihk.de/aschaffenburg/recht/internetrecht/barriere-6445858), [IHK Nordwestfalen](https://www.ihk.de/nordwestfalen/recht/internetrecht/barrierefreiheitsstaerkungsgesetz-6844448), [Noerr: Barrierefreiheit im E-Commerce](https://www.noerr.com/de/insights/barrierefreiheit-im-e-commerce-neue-pflichten-fuer-online-shop-betreiber-ab-juni-2025), [eRecht24](https://www.e-recht24.de/ecommerce/13337-barrierefreiheit-online-shop.html), [t3n](https://t3n.de/news/e-commerce-barrierefreiheitsstaerkungsgesetz-bussgelder-vermeiden-1629196/)
- E-Rechnung: [E-Rechnungspflicht 2025–2028 Leitfaden](https://kostenlose-erechnung.de/ratgeber/e-rechnungspflicht-leitfaden/), [E-Rechnungspflicht 2026 Übergangsfristen](https://kostenlose-erechnung.de/ratgeber/e-rechnungspflicht-2026-uebergangsfristen/), [B2Brouter Zeitplan](https://www.b2brouter.net/de/e-rechnungspflicht-fuer-deutsche-unternehmen-so-sieht-der-zeitplan-aus/)

Bekannte offizielle Grundlagen, zum Nachlesen empfohlen (in dieser Recherche nicht einzeln abgerufen):
- [Shopify Engineering: Under Deconstruction, the State of Shopify's Monolith](https://shopify.engineering/shopify-monolith) und [Packwerk](https://github.com/Shopify/packwerk)
- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) und [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Shopware Developer Docs](https://developer.shopware.com/docs/) (Admin API, Store API, Rule Builder, Shopping Experiences)
- [Shopify Developer Docs](https://shopify.dev/docs) (Functions, Checkout Extensibility, Markets, B2B)
