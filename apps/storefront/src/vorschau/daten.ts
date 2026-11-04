// Beispieldaten für die Vorschau der Storefront (Teeladen, Antwort Kristof 29.10.2026).
// Erfunden, nur zum Anschauen. Ab E14 kommen die Daten aus der Storefront API (/store/v1).
import { money, type Money } from "@shop/kernel";

export interface Kategorie {
  readonly slug: string;
  readonly name: string;
  readonly beschreibung: string;
}

export interface Produkt {
  readonly slug: string;
  readonly name: string;
  readonly kategorie: string;
  readonly kurz: string;
  readonly beschreibung: string;
  /** Bruttopreis in Cent. */
  readonly preis: Money;
  /** Füllmenge in Gramm, Grundlage für den Grundpreis (PAngV § 4). */
  readonly gramm: number;
  /** Steuersatz in Basispunkten (Tee: ermäßigt 7 %). */
  readonly steuerBp: number;
  readonly merkmale: readonly string[];
  readonly zubereitung: string;
  readonly herkunft: string;
  /** Farbe der Teedose in der Abbildung. */
  readonly farbe: string;
  readonly lieferzeit: string;
  readonly verfuegbar: boolean;
}

export const SHOP = {
  name: "Teeladen Morgentau",
  claim: "Loser Tee, sorgfältig ausgewählt.",
  firma: "Morgentau Tee GmbH (Beispiel)",
  ort: "Musterstraße 1, 12345 Musterstadt",
} as const;

export const KATEGORIEN: readonly Kategorie[] = [
  {
    slug: "gruentee",
    name: "Grüntee",
    beschreibung: "Frisch, grasig, manchmal leicht süß. Am besten mit 70 bis 80 °C heißem Wasser.",
  },
  {
    slug: "schwarztee",
    name: "Schwarztee",
    beschreibung: "Kräftig und malzig, pur oder mit einem Schuss Milch.",
  },
  {
    slug: "kraeutertee",
    name: "Kräutertee",
    beschreibung: "Ohne Koffein, für jede Tageszeit.",
  },
];

const EUR = (cent: number): Money => money(cent, "EUR");

export const PRODUKTE: readonly Produkt[] = [
  {
    slug: "sencha-fruehlingshauch",
    name: "Sencha Frühlingshauch",
    kategorie: "gruentee",
    kurz: "Japanischer Grüntee, frisch und mild",
    beschreibung:
      "Ein klassischer gedämpfter Grüntee aus Shizuoka. Leuchtend grüne Tasse, frischer Duft nach Gras und ein sanfter, leicht süßer Abgang.",
    preis: EUR(890),
    gramm: 100,
    steuerBp: 700,
    merkmale: ["Bio", "Erste Pflückung"],
    zubereitung: "3 g auf 250 ml, 75 °C, 1 bis 2 Minuten",
    herkunft: "Japan",
    farbe: "#7a9a5b",
    lieferzeit: "Lieferzeit 2–3 Werktage",
    verfuegbar: true,
  },
  {
    slug: "jasmin-perlen",
    name: "Jasmin-Perlen",
    kategorie: "gruentee",
    kurz: "Von Hand gerollt, mit Jasminblüten beduftet",
    beschreibung:
      "Junge Blätter werden zu kleinen Perlen gerollt und mehrere Nächte mit frischen Jasminblüten beduftet. Blumig, weich und mehrfach aufgießbar.",
    preis: EUR(1450),
    gramm: 75,
    steuerBp: 700,
    merkmale: ["Mehrfach aufgießbar"],
    zubereitung: "4 g auf 250 ml, 80 °C, 2 Minuten",
    herkunft: "China, Fujian",
    farbe: "#c9b46a",
    lieferzeit: "Lieferzeit 2–3 Werktage",
    verfuegbar: true,
  },
  {
    slug: "assam-morgenstund",
    name: "Assam Morgenstund",
    kategorie: "schwarztee",
    kurz: "Kräftiger Frühstückstee aus Indien",
    beschreibung:
      "Ein vollmundiger Assam mit goldenen Spitzen. Malzig und kräftig, passt gut zu Milch und weckt zuverlässig auf.",
    preis: EUR(690),
    gramm: 100,
    steuerBp: 700,
    merkmale: ["Mit Milch empfohlen"],
    zubereitung: "3 g auf 250 ml, 95 °C, 3 bis 4 Minuten",
    herkunft: "Indien, Assam",
    farbe: "#8a4b2f",
    lieferzeit: "Lieferzeit 2–3 Werktage",
    verfuegbar: true,
  },
  {
    slug: "earl-grey-classic",
    name: "Earl Grey Classic",
    kategorie: "schwarztee",
    kurz: "Schwarztee mit natürlichem Bergamotteöl",
    beschreibung:
      "Ceylon-Schwarztee mit dem Öl der Bergamotte-Frucht. Zitrusfrisch und elegant, ein Klassiker am Nachmittag.",
    preis: EUR(1190),
    gramm: 250,
    steuerBp: 700,
    merkmale: ["Großpackung"],
    zubereitung: "3 g auf 250 ml, 95 °C, 3 Minuten",
    herkunft: "Sri Lanka",
    farbe: "#3f5872",
    lieferzeit: "Lieferzeit 2–3 Werktage",
    verfuegbar: true,
  },
  {
    slug: "pfefferminze-pur",
    name: "Pfefferminze pur",
    kategorie: "kraeutertee",
    kurz: "Ganze Minzblätter, kühl und klar",
    beschreibung:
      "Große, ganze Blätter der Pfefferminze aus deutschem Anbau. Kühl, klar und ohne Zusätze, heiß oder kalt ein Genuss.",
    preis: EUR(550),
    gramm: 50,
    steuerBp: 700,
    merkmale: ["Bio", "Ohne Koffein", "Aus Deutschland"],
    zubereitung: "2 g auf 250 ml, 100 °C, 5 bis 8 Minuten",
    herkunft: "Deutschland",
    farbe: "#4f8a7a",
    lieferzeit: "Lieferzeit 2–3 Werktage",
    verfuegbar: true,
  },
  {
    slug: "rooibos-vanille",
    name: "Rooibos Vanille",
    kategorie: "kraeutertee",
    kurz: "Südafrikanischer Rotbusch mit echter Vanille",
    beschreibung:
      "Rooibos aus den Zederbergen mit Stückchen echter Bourbon-Vanille. Rund, weich und von Natur aus süßlich.",
    preis: EUR(790),
    gramm: 100,
    steuerBp: 700,
    merkmale: ["Ohne Koffein"],
    zubereitung: "3 g auf 250 ml, 100 °C, 6 Minuten",
    herkunft: "Südafrika",
    farbe: "#b0603d",
    lieferzeit: "Zurzeit ausverkauft",
    verfuegbar: false,
  },
];

export function kategorie(slug: string): Kategorie {
  const k = KATEGORIEN.find((x) => x.slug === slug);
  if (k === undefined) throw new Error(`Unbekannte Kategorie ${slug}`);
  return k;
}

export function produkteIn(slug: string): readonly Produkt[] {
  return PRODUKTE.filter((p) => p.kategorie === slug);
}
