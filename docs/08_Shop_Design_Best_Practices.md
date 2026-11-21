# Design-Best-Practices für Shops

Stand: 21.11.2026. Recherche auf Kristofs Wunsch („sieh dir Shopify-Shops an und analysiere deren
Best Practices"). Grundlage: Shopifys eigene Liste der bestbewerteten Shop-Designs 2026, mehrere
unabhängige Auswertungen von Shop-Designs, Baymard-Empfehlungen zum Produktraster und die Technik
der Shopify-Theme-Familie Horizon. Quellen stehen am Ende.

Dieses Dokument ist die Messlatte für das Standard-Aussehen der Storefront und für den Umfang des
Baukasten-Editors. Was daraus schon umgesetzt ist, steht in `STATUS.md`.

## 1. Die Bühne entscheidet

Der erste Bildschirm hat genau eine Aufgabe: In fünf Sekunden muss klar sein, was der Shop verkauft,
für wen es ist und warum man bleiben soll. Was dort hingehört:

- **Ein Bild, das das Produkt im Gebrauch zeigt**, nicht ein abstraktes Stimmungsbild. Bei Lebensmitteln
  und Getränken Nahaufnahmen; bei Mode ein ganzes Bild im Stil eines Lookbooks.
- **Eine Überschrift unter zehn Wörtern**, die den Nutzen nennt, und eine Unterzeile, die sagt, für wen.
- **Genau ein Hauptknopf.** Mehrere gleichrangige Knöpfe kosten messbar Klicks, weil der Besucher
  sich entscheiden muss, statt zu handeln.
- **Höhe:** am Computer 60 bis 100 Prozent der Bildschirmhöhe, am Handy 50 bis 70 Prozent. Der Knopf
  muss bei 375 Pixel Breite ohne Scrollen sichtbar sein.
- **Kein automatischer Bildwechsel.** Jakob Nielsen nennt automatisch weiterlaufende Bühnen „deadly":
  sie erhöhen die Last für den Besucher und werden für Werbung gehalten.

Technisch ist das Bühnenbild fast immer das größte Element der Seite und bestimmt damit die gemessene
Ladezeit. Es darf deshalb nicht verzögert geladen werden, sondern bekommt Vorrang, und es sollte als
WebP oder AVIF ausgeliefert werden. Es muss außerdem im Hochformat funktionieren, ohne dass das Motiv
weggeschnitten wird.

## 2. Was unter der Bühne kommt

Die Reihenfolge, die sich in den gut bewerteten Shops wiederholt:

1. **Drei bis fünf Kategorien als Kacheln** mit Bild und Beschriftung. Sie ersetzen für die meisten
   Besucher das Menü.
2. **Eine Reihe Produkte**: Empfehlungen, Bestseller oder Neuheiten. Hier zeigt der Shop zum ersten Mal
   Preise.
3. **Vertrauen in einer Zeile**: Versandkosten, Rückgabe, Kontakt. Fünf gestapelte Siegel schwächen
   sich gegenseitig; eine ruhige Zeile wirkt stärker.
4. **Eine Geschichte oder ein Stichwort zur Marke**, kurz, mit Bild.

## 3. Produktraster und Produktkarte

- **Spalten:** am Computer drei bis vier, am Handy zwei (Baymard). Bei Produkten, bei denen das Detail
  zählt (Möbel, Kunst), lieber zwei bis drei große Spalten.
- **Je Seite 24 bis 48 Produkte**, danach weiterblättern.
- **Die Karte zeigt:** Bild, Name, Preis. Optional, aber wirksam: ein zweites Bild beim Überfahren,
  Marken wie „Neu" oder „Fast ausverkauft", Bewertung.
- **Gleich große Karten und gleicher Abstand** überall. Unruhige Raster lesen sich als Nachlässigkeit.
- **Schnell in den Warenkorb** direkt von der Karte, bei Produkten ohne Varianten als einfacher Knopf.
  Wichtig: Der Knopf darf nicht nur beim Überfahren mit der Maus erscheinen, sonst ist er am Handy und
  mit der Tastatur nicht erreichbar. Richtig ist, ihn zusätzlich bei Tastatur-Fokus und auf Geräten ohne
  Mauszeiger dauerhaft zu zeigen.
- **Gegenargument, das wir beachten:** Ein Karten-Knopf in einem Raster mit 36 Produkten erzeugt 36
  gleichrangige Handlungsaufforderungen und zieht die Aufmerksamkeit von der eigentlichen Aufgabe ab,
  nämlich dem Finden. Deshalb zurückhaltend und ruhig gestalten, nicht in der Hauptfarbe.

## 4. Die eine Gemeinsamkeit guter Shops

Die durchweg hoch bewerteten Shops haben kein gemeinsames Aussehen, aber eine gemeinsame Disziplin:
**eine Palette, zwei Schriften, ein Fotostil, ausnahmslos durchgehalten.** Mehrere Auswertungen nennen
genau das als Unterschied zwischen „sieht gemacht aus" und „sieht gebastelt aus". Für uns heißt das:
Die Vorlagen müssen in sich geschlossen sein, und der Editor sollte es schwer machen, sie zu zerstören
(begrenzte Auswahl statt freier Zahlenfelder).

Zwei wiederkehrende Muster, die wir übernehmen können:

- **Tonal:** alles in Abstufungen einer Farbfamilie statt mit Kontrastfarben (SKIMS).
- **Redaktionell:** der Shop wie eine Zeitschrift, mit Saison-Geschichten vor den Produkten (Kith).
  Das haben wir mit der Vorlage „Editorial" im Ansatz schon.

## 5. Shopify Horizon als Vorbild für den Editor

Horizon ist seit 2025 Shopifys Standard und zugleich eine Familie von zehn kostenlosen Vorlagen auf
derselben Grundlage. Technisch interessant sind drei Entscheidungen:

- **Bausteine statt fester Abschnitte.** Ein Baustein ist nicht an einen Abschnitt gebunden, sondern
  überall wiederverwendbar, auch auf anderen Seitentypen.
- **Verschachtelung bis acht Ebenen**, vor allem über einen „Gruppe"-Baustein, der andere Bausteine
  enthält. Damit baut der Händler eine Bühne, die eine Gruppe mit Überschrift, Text und zwei Knöpfen
  enthält, ohne dass dafür ein eigener Bühnen-Typ nötig ist.
- **Zehn Vorlagen für Branchen** (Mode, Lebensmittel, Kosmetik, Elektronik, Wohnen, Outdoor, Kunst,
  Wellness, Accessoires, allgemein) als Startpunkt, nicht als Korsett. Dazu rund 40 Abschnitte und
  etwa 95 Bausteine in der Theme-Datei.

Unser Baukasten hat die Bausteine, aber keine Verschachtelung und keine Branchen-Startpunkte. Das sind
die zwei größten Lücken gegenüber dem Vorbild.

## 6. Daraus abgeleitete Aufgaben für Slopify

Nach Wirkung sortiert, 1 ist das Wichtigste:

1. **Standard-Shop hat ab der ersten Minute ein Bild oben.** Ein neuer Shop ohne eigenes Bühnenbild
   zeigt heute eine farbige Fläche. Besser: eine Bühne, die ohne eigenes Bild das erste Produktbild
   oder ein Kategoriebild groß zeigt, mit Überschrift, einer Zeile und einem Knopf.
2. **Echte Fotos in den Testdaten.** Gezeichnete Platzhalter lassen jedes Design schlecht aussehen,
   egal wie gut es ist.
3. **Kategoriebilder im Standard**, damit die Kacheln unter der Bühne Bilder statt Farbflächen zeigen.
4. **Bühnen-Zuschnitt beherrschen:** festes Seitenverhältnis, Motiv-Mittelpunkt wählbar, am Handy
   Hochformat ohne Textverlust.
5. **Produktkarte aufwerten:** zweites Bild beim Überfahren, ruhiger „In den Warenkorb" auf der Karte,
   der auch per Tastatur und am Handy erreichbar ist.
6. **Gruppen-Baustein** (Bausteine in Bausteinen), damit Bühne und Abschnitte frei zusammengesetzt
   werden können.
7. **Branchen-Startpunkte**: drei bis vier fertige Shop-Anfänge (Lebensmittel, Mode, Wohnen), die
   Farben, Schrift, Bausteine und Beispieltexte zusammen setzen.
8. **Suche im Kopf wählbar** (offenes Feld oder Lupe, die aufklappt) und weitere Einstellungen, die man
   beim Ausprobieren merkt.
9. **Vertrauenszeile** als eigener Baustein (Versand, Rückgabe, Kontakt), höchstens drei Punkte.

## Quellen

- [13 Best Shopify Website Designs and 2026 Trends](https://www.shopify.com/blog/11863377-30-beautiful-and-creative-ecommerce-website-designs)
- [10 Best Shopify Website Design Examples (2026)](https://enstacked.com/best-shopify-website-design-examples/)
- [Best Shopify Store Examples: 30+ Stores Worth Studying in 2026](https://www.clyro.com/blog/best-shopify-store-examples)
- [High-Converting eCommerce Homepages](https://www.convertcart.com/blog/high-converting-ecommerce-homepage)
- [Ecommerce Homepage Optimization: 2026 UX & Conversion Guide](https://ecomhint.com/guides/homepage-optimization)
- [Ecommerce Homepage Design: The Complete Guide](https://www.btng.studio/articles/ecommerce-homepage-design/)
- [Product Listing Page Best Practices (2026)](https://suplex.design/blog/product-listing-page-best-practices)
- [Shopify Collection Page Design: Best Practices (2026)](https://100xelevate.com/insights/shopify-collection-page-design/)
- [Shopify Horizon Themes Explained](https://debutify.com/blog/shopify-horizon-themes-explained)
- [Shopify Horizon Theme Review: Horizon vs Dawn (2026)](https://fuelthemes.net/shopify-horizon-theme-review/)
- [Shopify Horizon Theme Customization Guide 2026](https://craftshift.com/shopify-horizon-theme-customization-guide-2026/)
