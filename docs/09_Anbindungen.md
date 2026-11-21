# Anbindungen: was wo eingebaut wird

Stand: 21.11.2026. Kristofs Auswahl aus der Ideenliste im Chat. Für jeden Dienst steht hier, wo er
im Backoffice oder im Shop sitzt, was dafür gebaut werden muss, was Kristof selbst tun muss und wie
groß der Aufwand ist.

**Nutzen** ist auf der Skala 1 bis 9 angegeben, 1 ist am besten. **Aufwand** ist in Arbeitsläufen
geschätzt, ein Lauf ist eine abgeschlossene Etappe.

## 0. Zuerst das Fundament, sonst wird jede Anbindung ein Einzelstück

Heute gibt es keinen Ort, an dem ein Händler einen Zugangsschlüssel hinterlegt. Der einzige
Schlüssel im System, der für den KI-Assistenten, kommt aus einer Umgebungsvariablen und gilt für die
ganze Plattform. Zwölf der achtzehn Dienste unten brauchen aber einen Schlüssel oder eine
Einstellung pro Shop. Ohne Fundament würde jede Anbindung ihre eigene Lösung erfinden.

Zu bauen ist deshalb zuerst:

1. **Neues Modul `integrations`** mit einer Tabelle je Shop: welcher Dienst, an oder aus,
   Einstellungen, Zugangsdaten. Die Zugangsdaten werden verschlüsselt abgelegt, nicht im Klartext,
   und kommen nie über die API zurück an den Browser (nur „hinterlegt" oder „fehlt").
2. **Neue Seite „Einstellungen → Anbindungen"** im Backoffice: eine Kachel je Dienst mit Schalter,
   Feldern für die Zugangsdaten, einem Knopf „Verbindung prüfen" und dem letzten Ergebnis.
3. **Ein gemeinsamer Weg nach außen**: ein Ausgangs-Klient mit Zeitlimit, Wiederholung und
   Protokoll, damit ein langsamer fremder Dienst nie den Shop ausbremst.

Aufwand: 2 Läufe. Danach ist fast jede einzelne Anbindung ein halber Lauf statt eines ganzen.

## 1. Übersicht

| Dienst | Wo du es bedienst | Was du tun musst | Nutzen | Aufwand |
| --- | --- | --- | --- | --- |
| Telegram-Bot | Einstellungen → Anbindungen | Bot bei BotFather anlegen, Schlüssel einfügen | 2 | 0,5 Lauf |
| ntfy | Einstellungen → Anbindungen | App installieren, Thema wählen | 3 | 0,5 Lauf |
| Photon (Adressen) | Kasse, automatisch | nichts | 2 | 0,5 Lauf |
| Unsplash | Editor und Produktbilder | Entwicklerkonto, Schlüssel einfügen | 2 | 1 Lauf |
| IndexNow | Einstellungen → Anbindungen | nichts | 3 | 0,5 Lauf |
| Produktfeed | Einstellungen → Anbindungen (Adresse zum Kopieren) | Konto bei Google Merchant, wenn du ihn dort einreichst | 2 | 1 Lauf |
| Open Food Facts | Produkt anlegen, Feld „Barcode" | nichts | 5 | 0,5 Lauf |
| Mollie | Einstellungen → Zahlarten | Mollie-Konto, Testschlüssel einfügen | 3 | 1,5 Läufe |
| Eigene Bewertungen | Neuer Punkt „Bewertungen" im Menü | nichts | 2 | 3 Läufe |
| rembg (freistellen) | Produktbild, Knopf „Hintergrund entfernen" | nichts | 4 | 1,5 Läufe |
| Slopify als MCP-Server | Einstellungen → Anbindungen | Adresse in Claude eintragen | 1 | 2 Läufe |
| Plausible | Neue Seite „Statistiken" | nichts | 3 | 2 Läufe |
| Smartsupp | Einstellungen → Anbindungen | Konto, Schlüssel einfügen | 5 | 0,5 Lauf |
| DHL | Bestellung, Knopf „Label erstellen" | Entwicklerkonto bei DHL | 4 | 2 Läufe |
| Google Search Console | Seite „Statistiken" | Google-Cloud-Projekt, Zugriff freigeben | 4 | 2 Läufe |
| DataForSEO | Seite „Suchbegriffe" | Konto mit Guthaben | 5 | 1,5 Läufe |
| DeepL | Produkt- und Kategorietexte | Konto, Schlüssel einfügen | 4 | 3 Läufe |
| EU-VIES | Kasse, automatisch bei Geschäftskunden | nichts | 6 | 1 Lauf |
| WhatsApp Business | Einstellungen → Anbindungen | Meta-Unternehmenskonto, Rufnummer, Vorlagen freigeben lassen | 7 | 3 Läufe |

## 2. Bilder und Texte

### Unsplash

**Wo:** Überall dort, wo heute „Bild hochladen" steht, kommt ein zweiter Reiter „Bild suchen" dazu:
im Baukasten-Editor beim Bühnen- und Bild-Baustein, beim Kategoriebild und beim Produktbild.

**Zu bauen:** Ein Endpunkt, der die Suche an Unsplash weiterreicht (der Schlüssel bleibt auf dem
Server und geht nie an den Browser), eine Bildauswahl im Backoffice, und das Übernehmen eines
gewählten Bildes direkt in den Medienspeicher des Shops. Unsplash verlangt, dass der Name der
Fotografin genannt und ein Abruf gemeldet wird; beides gehört in dieselbe Stelle.

**Was du tun musst:** Konto auf unsplash.com/developers anlegen, eine Anwendung registrieren und den
Schlüssel in die Einstellungen eintragen. Die Demo-Stufe erlaubt 50 Abrufe je Stunde und reicht zum
Ausprobieren; für mehr muss die Anwendung von Unsplash freigegeben werden.

**Empfehlung dazu:** Zusätzlich **Openverse** als zweite Quelle im selben Dialog. Openverse braucht
keinen Schlüssel und liefert nur gemeinfreie Bilder, also ohne Namensnennung. Genau daher kommen die
Fotos, die jetzt in den Testshops stehen. Kostet beim Bauen fast nichts mehr, wenn die Bildauswahl
sowieso entsteht.

### rembg (Hintergrund freistellen)

**Wo:** Beim Produktbild ein Knopf „Hintergrund entfernen", Ergebnis als zweite Fassung zum
Vergleichen, mit „Übernehmen" oder „Verwerfen".

**Zu bauen:** Ein eigener kleiner Dienst im Docker-Verbund neben API, Shop und Backoffice. rembg
ist ein freies Programm, das ein neuronales Netz lokal ausführt; es läuft ohne Internet und ohne
Konto. Das Medien-Modul schickt das Bild hin und bekommt es freigestellt zurück.

**Was du tun musst:** Nichts. Aber: Der Dienst braucht etwa 1 GB Arbeitsspeicher, und der
Testserver hat nicht unbegrenzt davon. Vor dem Einbau prüfen, ob dort noch Luft ist.

### DeepL

**Wo:** Neben jedem längeren Textfeld bei Produkt, Kategorie und im Editor ein Knopf „Übersetzen".

**Ehrliche Einschätzung:** Die Anbindung an DeepL selbst ist eine Stunde Arbeit. Der eigentliche
Aufwand ist, dass der Shop noch keine zweite Sprache anzeigen kann. Das Datenmodell ist dafür
vorbereitet, aber Oberfläche, Shop-Ausgabe, Sprachumschalter und Adressen fehlen. Das ist in Welle 4
eingeplant. Sinnvoll ist deshalb: DeepL erst zusammen mit der zweiten Sprache bauen, sonst
übersetzt der Knopf in ein Feld, das niemand sieht.

**Was du tun musst:** Konto bei DeepL anlegen. Die kostenlose Stufe erlaubt 500.000 Zeichen im Monat,
verlangt bei der Anmeldung aber eine Zahlungsart zur Prüfung.

### Open Food Facts

**Wo:** Beim Anlegen eines Produkts ein Feld „Barcode" mit Knopf „Daten holen". Name, Marke,
Zutaten, Nährwerte und ein Bild kommen automatisch.

**Was du tun musst:** Nichts, die Datenbank ist frei und braucht keinen Schlüssel.

**Einschränkung:** Es gibt nur Lebensmittel und Kosmetik. Für den Modeladen bringt es nichts. Für
einen Teeladen ist die Abdeckung bei kleinen Manufakturen dünn.

## 3. Gefunden werden

### IndexNow

**Wo:** Ein Schalter in den Anbindungen, sonst unsichtbar.

**Zu bauen:** Sobald ein Produkt oder eine Seite veröffentlicht wird, geht eine Meldung an IndexNow.
Bing und Yandex holen die Seite dann sofort statt irgendwann. Dazu muss eine Schlüsseldatei unter
der Shop-Adresse abrufbar sein; die erzeugt der Shop selbst.

**Was du tun musst:** Nichts. Das Ganze sind etwa zehn Zeilen und der beste Nutzen je Aufwand in
dieser ganzen Liste.

**Voraussetzung:** Der Shop muss öffentlich erreichbar sein, also auf dem Testserver laufen.

### Produktfeed

**Wo:** In den Anbindungen eine Adresse zum Kopieren, pro Shop, dazu ein Schalter, welche Produkte
enthalten sind.

**Zu bauen:** Zwei Ausgaben derselben Daten: eine XML-Datei im Format von Google Merchant Center
(das lesen auch Meta und die meisten Preisvergleiche) und eine JSON-Datei nach der Spezifikation für
KI-Einkaufsassistenten. Dazu strukturierte Daten direkt auf der Produktseite, damit eine KI die
Seite auch ohne Feed versteht. Das ist dasselbe Thema wie der Blogartikel zur KI-Suche.

**Was du tun musst:** Nichts, wenn du den Feed nur haben willst. Wenn du ihn bei Google einreichen
willst, brauchst du ein kostenloses Konto bei Google Merchant Center.

### Google Search Console

**Wo:** Auf einer neuen Seite „Statistiken", zusammen mit Plausible: mit welchen Suchbegriffen Leute
im Shop landen, welche Seiten Treffer bekommen, wo der Shop auf Seite zwei steht.

**Zu bauen:** Anmeldung über Google (OAuth), Abholen der Zahlen einmal am Tag, Zwischenspeicher,
Darstellung.

**Was du tun musst:** Ein Projekt in der Google Cloud Console anlegen, die Search-Console-API
einschalten, einen OAuth-Zugang erstellen und den Shop in der Search Console als dein Eigentum
bestätigen. Das ist der bürokratischste Punkt der ganzen Liste, etwa eine halbe Stunde Klickarbeit.

### DataForSEO

**Wo:** Eine neue Seite „Suchbegriffe", zusätzlich ein kleiner Bereich im Editor und beim
Kategorietext: „Wonach suchen Leute hier?"

**Zu bauen:** Suche nach Begriffen mit Suchvolumen, eine Beobachtungsliste mit Positionen über die
Zeit, und ein täglicher Lauf, der die Positionen nachträgt.

**Was du tun musst:** Konto bei DataForSEO mit Guthaben. Jeder Abruf kostet Bruchteile eines Cents,
aber es ist der einzige Dienst in dieser Liste, der echtes Geld kostet. Deshalb gehört eine Grenze
dazu: wie viele Abrufe am Tag höchstens.

## 4. Nachrichten an dich

### Telegram-Bot

**Wo:** Einstellungen → Anbindungen → Telegram, mit Feldern für den Schlüssel und einem Knopf
„Testnachricht senden".

**Zu bauen:** Das Modul für Benachrichtigungen gibt es schon; es bekommt einen zweiten Weg neben der
E-Mail. Auswählbar, worüber du Bescheid bekommst: neue Bestellung, neue Nachricht im Posteingang,
Produkt ausverkauft.

**Was du tun musst:** In Telegram den „BotFather" anschreiben, `/newbot` eingeben, Namen vergeben,
den Schlüssel kopieren und einfügen. Das dauert zwei Minuten und kostet nichts. Deine Chat-Nummer
holt sich der Shop selbst, sobald du dem Bot einmal schreibst.

**Das ist dein Punkt 3 aus der Ideenliste und das, was die Uhr-App sollte, in einem Bruchteil der
Zeit.** Auf der Galaxy Watch kommt die Telegram-Nachricht ohnehin an.

### ntfy — was das ist

ntfy (gesprochen „notify") ist ein freier Push-Dienst. Du installierst die ntfy-App auf dem Handy
oder der Uhr und abonnierst dort ein selbst ausgedachtes Thema, zum Beispiel
`slopify-bestellungen-7f3a9c`. Der Shop schickt an `https://ntfy.sh/slopify-bestellungen-7f3a9c`
eine einfache Nachricht, und dein Handy klingelt. Kein Konto, keine Anmeldung, kein Schlüssel.

Der Haken: Jeder, der den Themennamen errät, kann mitlesen. Deshalb muss das Thema lang und zufällig
sein, und es darf nichts Persönliches drinstehen, also „Neue Bestellung über 24,50 €" statt Name und
Adresse. Wer es ernst meint, hostet ntfy selbst; das Programm ist frei.

**Mein Rat:** Telegram und ntfy machen dasselbe. Telegram ist sicherer und du hast es vermutlich
schon. ntfy ist interessant, wenn du kein Telegram willst. Ich würde Telegram bauen und ntfy nur
dann hinterherschieben, wenn dir Telegram nicht gefällt.

### WhatsApp Business Cloud

**Wo:** Anbindungen, für Bestellbestätigung und Versandmeldung an den Kunden.

**Was du tun musst:** Ein Meta-Unternehmenskonto, eine Rufnummer, die noch bei keinem WhatsApp-Konto
hängt, eine Prüfung des Unternehmens und die Freigabe jeder einzelnen Nachrichtenvorlage durch Meta.
Für eine Spielwiese ohne echte Firma ist das sehr viel Bürokratie, und die Prüfung kann an der
fehlenden echten Firma scheitern.

**Mein Rat:** Als Letztes, und nur wenn du es wirklich sehen willst.

## 5. Kundenkontakt im Shop

### Smartsupp

**Wo:** Anbindungen, ein Feld für den Schlüssel, ein Schalter „Chat im Shop zeigen".

**Zu bauen:** Fast nichts, es ist ein Schnipsel JavaScript im Shop. Zu beachten ist die
Inhaltssicherheitsrichtlinie des Shops: Sie muss den fremden Dienst erlauben, und zwar genau ihn und
nichts sonst.

**Was du tun musst:** Konto bei Smartsupp anlegen, Schlüssel einfügen.

**Zum Abwägen:** Ein fremdes Skript im Shop setzt Cookies und verlangt in einem echten Shop eine
Einwilligung. Die Alternative wäre, dass dein eigener KI-Assistent die Kundenfragen beantwortet, mit
den Daten des Shops im Rücken. Das ist mehr Arbeit, passt aber besser zu „KI-first" und zu dem,
womit sich Slopify von anderen unterscheidet.

### Eigene Bewertungen

**Wo:** Neuer Punkt „Bewertungen" im Menü unter VERKAUF. Im Shop Sterne auf der Produktkarte und
Rezensionen auf der Produktseite.

**Zu bauen:** Ein neues Modul: Kunde bekommt nach dem Kauf eine Mail mit einem einmaligen Link,
schreibt Sterne und Text, der Händler gibt frei oder lehnt ab und kann antworten. Dazu
strukturierte Daten, damit Google die Sterne in den Suchergebnissen zeigt. Wichtig und oft
vergessen: Nach deutschem Recht muss dabeistehen, ob geprüft wurde, dass die Bewertung von einem
echten Käufer stammt.

**Was du tun musst:** Nichts, das ist komplett dein eigenes.

## 6. Kasse und Versand

### Photon (Adressvervollständigung)

**Wo:** In der Kasse. Der Kunde tippt die Straße, darunter erscheinen Vorschläge mit Postleitzahl
und Ort.

**Zu bauen:** Ein Endpunkt, der an Photon weiterreicht und auf Deutschland begrenzt, dazu das
Vorschlagsfeld in der Kasse. Photon ist der freie Adressdienst von Komoot auf Basis von
OpenStreetMap.

**Was du tun musst:** Nichts, kein Schlüssel nötig. Die öffentliche Adresse ist für faire Nutzung
gedacht; wer viel abfragt, hostet selbst.

**Warum weit oben:** Weniger Tippfehler in Adressen, weniger abgebrochene Käufe, und man merkt es
beim Ausprobieren sofort.

### DHL

**Wo:** In einer Bestellung ein Knopf „Label erstellen", danach Sendungsnummer und Verfolgung in der
Bestellung und in der Versandmail.

**Zu bauen:** Anbindung an die Versand-API, PDF des Labels speichern, Sendungsnummer in die
Bestellung, Statusabfrage.

**Was du tun musst:** Konto im DHL-Entwicklerportal, eine Anwendung anlegen, Sandbox-Zugangsdaten
holen. Zum Ausprobieren reicht die Sandbox und kostet nichts. Echte Labels bräuchten einen
Geschäftskundenvertrag, den du nicht hast und für eine Spielwiese auch nicht brauchst.

### Mollie

**Wo:** Einstellungen → Zahlarten, neben der Testzahlung.

**Zu bauen:** Das Zahlungsmodul hat schon eine Spalte für den Anbieter, es ist also kein Umbau,
sondern ein zweiter Anbieter: Zahlung anlegen, Kunde zu Mollie schicken, Rückmeldung
entgegennehmen und prüfen, dass sie echt ist.

**Was du tun musst:** Mollie-Konto anlegen und den Testschlüssel einfügen. Testzahlungen gehen ohne
Vertrag und ohne Firmenprüfung, das ist bei Mollie einfacher als bei den meisten.

### EU-VIES

**Wo:** In der Kasse, wenn der Kunde eine Umsatzsteuer-Identifikationsnummer eingibt, und in der
Kundenverwaltung.

**Zu bauen:** Abfrage beim Dienst der EU-Kommission, Ergebnis speichern. Stimmt die Nummer, wird bei
Lieferung ins EU-Ausland ohne Steuer berechnet.

**Was du tun musst:** Nichts, der Dienst ist frei.

**Einschränkung:** Das ergibt erst Sinn, wenn es Geschäftskunden gibt, und das ist Welle 3. Vorher
hat niemand ein Feld, in das er die Nummer schreiben könnte.

## 7. Zahlen

### Plausible

**Wo:** Neue Seite „Statistiken" im Backoffice, zusammen mit den Zahlen aus der Search Console:
Besucher, Seitenaufrufe, woher sie kommen, welche Seiten beliebt sind.

**Zu bauen:** Plausible selbst hosten (eigener Dienst im Docker-Verbund mit eigener Datenbank), ein
schlankes Zählskript in den Shop, und die Zahlen über die API von Plausible im Backoffice anzeigen.
Plausible setzt keine Cookies und speichert keine persönlichen Daten, deshalb braucht es keinen
Einwilligungsbanner.

**Was du tun musst:** Nichts, wenn wir selbst hosten.

**Alternative:** Umami kann fast dasselbe, ist deutlich leichter und braucht weniger Speicher. Wenn
der Testserver knapp ist, würde ich Umami nehmen.

## 8. Slopify als MCP-Server

**Wo:** Einstellungen → Anbindungen → „Mit Claude oder ChatGPT verbinden": eine Adresse und ein
Zugangsschlüssel, den der Händler sich dort erzeugt.

**Zu bauen:** Ein MCP-Endpunkt, der die vorhandene Admin-API als Werkzeuge anbietet: Produkte
anlegen und ändern, Bestellungen ansehen, Preise pflegen, Texte schreiben. Die Rechte sind dieselben
wie beim Zugangsschlüssel, es entsteht also keine neue Tür ins System, nur eine andere Klinke.

**Was du tun musst:** Die Adresse in Claude als Connector eintragen.

**Warum ich das für den interessantesten Punkt halte:** Du arbeitest heute schon so, mit dem
ePages-MCP-Server. Für Slopify wäre das die Umsetzung von „der Händler macht alles im Chat", und es
unterscheidet die Plattform von allem, was es sonst gibt. Außerdem baust du damit dein eigenes
Werkzeug, um den Shop zu pflegen, ohne durchs Backoffice zu klicken.

## 9. Was du insgesamt besorgen müsstest

| Konto oder Schlüssel | Wofür | Kosten | Aufwand für dich |
| --- | --- | --- | --- |
| Telegram-Bot bei BotFather | Benachrichtigungen | keine | 2 Minuten |
| Unsplash-Entwicklerkonto | Bildersuche | keine | 10 Minuten |
| Mollie-Konto | Testzahlungen | keine | 15 Minuten |
| DHL-Entwicklerportal | Versandlabel | keine (Sandbox) | 20 Minuten |
| Google Cloud + Search Console | Suchbegriffe | keine | 30 Minuten |
| Google Merchant Center | Produktfeed einreichen | keine | 20 Minuten |
| DeepL | Übersetzungen | keine bis 500.000 Zeichen, Zahlungsart zur Prüfung nötig | 10 Minuten |
| Smartsupp | Chat | keine in der Grundstufe | 10 Minuten |
| DataForSEO | Suchbegriffe und Positionen | Guthaben, Bruchteile von Cents je Abruf | 15 Minuten |
| Meta-Unternehmenskonto | WhatsApp | keine, aber Prüfung durch Meta | Stunden, Ausgang offen |

Für ntfy, Photon, IndexNow, Open Food Facts, EU-VIES, Plausible, rembg, eigene Bewertungen und den
MCP-Server brauchst du gar nichts.

## 10. Vorgeschlagene Reihenfolge

**Erst das Fundament** (Abschnitt 0, 2 Läufe), sonst wird jedes Stück teurer als nötig.

**Welle A, schnell und sofort spürbar (zusammen etwa 3 Läufe):** Telegram, Photon, IndexNow,
Produktfeed. Alle vier brauchen kaum etwas von dir, und drei davon kosten dich keine Minute.

**Welle B, das, was den Shop besser aussehen lässt (etwa 4 Läufe):** Unsplash samt Openverse,
rembg, Mollie.

**Welle C, das Eigenständige (etwa 5 Läufe):** MCP-Server, eigene Bewertungen.

**Welle D, Zahlen (etwa 4 Läufe):** Plausible oder Umami, Google Search Console, DataForSEO.

**Später:** DeepL zusammen mit der zweiten Sprache, EU-VIES zusammen mit Geschäftskunden, DHL wenn
Versandarten stehen, Smartsupp falls der eigene Assistent nicht reicht, WhatsApp zuletzt.
