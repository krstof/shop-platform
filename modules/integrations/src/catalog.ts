// Katalog der Anbindungen (21.11.2026).
//
// Jede Anbindung wird hier einmal beschrieben: Name, Erklärung in Alltagssprache, welche Felder sie
// braucht und welche davon geheim sind. Die Seite „Einstellungen → Anbindungen“ im Backoffice baut
// sich allein aus diesem Katalog auf; für eine neue Anbindung ist dort nichts zu ändern.
//
// Geheime Felder gehen nur in eine Richtung: Der Browser schickt sie hin, bekommt aber nie einen
// Wert zurück, sondern nur „hinterlegt“ oder „fehlt“.

/** Ein Feld, das der Händler ausfüllt. */
export interface IntegrationField {
  readonly key: string;
  readonly label: string;
  /** Hilfstext unter dem Feld, in Alltagssprache. */
  readonly hint?: string;
  /** Geheim: wird verschlüsselt gespeichert und nie zurückgegeben. */
  readonly secret: boolean;
  /** Muss ausgefüllt sein, damit die Anbindung eingeschaltet werden kann. */
  readonly required: boolean;
  readonly maxLength: number;
}

export interface IntegrationDefinition {
  readonly provider: string;
  readonly name: string;
  /** Ein bis zwei Sätze: Was bringt die Anbindung dem Händler? */
  readonly description: string;
  /** Wo im Backoffice oder Shop sie wirkt, als Hinweis auf der Kachel. */
  readonly where: string;
  /** Was der Händler selbst besorgen muss; leer, wenn nichts nötig ist. */
  readonly setup?: string;
  /** Adresse der Anleitung des Anbieters. */
  readonly helpUrl?: string;
  readonly fields: readonly IntegrationField[];
  /** Kann „Verbindung prüfen“ etwas Sinnvolles tun? */
  readonly testable: boolean;
  /**
   * An, solange der Händler nichts anderes eingestellt hat. Nur für Anbindungen ohne Zugangsdaten,
   * die nichts kosten und niemandem schaden — sonst müsste jeder Händler erst etwas einschalten,
   * das er gar nicht vermisst hat.
   */
  readonly defaultEnabled?: boolean;
  /**
   * Pfad im Shop, den der Händler braucht, etwa „/produkte.xml“. Das Backoffice zeigt daraus die
   * fertige Adresse zum Kopieren, weil nur es weiß, unter welcher Adresse der Shop läuft.
   */
  readonly shopUrlPath?: string;
}

export const INTEGRATIONS: readonly IntegrationDefinition[] = [
  {
    provider: "telegram",
    name: "Telegram",
    description:
      "Schickt dir eine Nachricht aufs Handy, sobald eine Bestellung eingeht oder jemand über das " +
      "Kontaktformular schreibt. Auf einer Smartwatch kommt sie ebenfalls an.",
    where: "Benachrichtigungen an dich",
    setup:
      "Schreibe in Telegram den „BotFather“ an, sende /newbot, vergib einen Namen und kopiere den " +
      "Schlüssel hierher. Danach schreibe deinem eigenen Bot einmal „Hallo“ und drücke hier auf " +
      "„Verbindung prüfen“ — die Chat-Nummer holt sich der Shop dann selbst.",
    helpUrl: "https://core.telegram.org/bots/features#botfather",
    testable: true,
    fields: [
      {
        key: "botToken",
        label: "Schlüssel des Bots",
        hint: "Die lange Zeichenkette vom BotFather, etwa 123456789:AA....",
        secret: true,
        required: true,
        maxLength: 200,
      },
      {
        key: "chatId",
        label: "Chat-Nummer",
        hint: "Bleibt leer: Der Shop trägt sie bei der Verbindungsprüfung selbst ein.",
        secret: false,
        required: false,
        maxLength: 40,
      },
    ],
  },
  {
    provider: "unsplash",
    name: "Unsplash",
    description:
      "Gibt dir im Editor und bei den Produktbildern eine Bildersuche mit Millionen guter Fotos. " +
      "Ohne Unsplash suchst du nur in gemeinfreien Bildern über Openverse, das immer dabei ist.",
    where: "Bildersuche im Editor und bei Produkt- und Kategoriebildern",
    setup:
      "Lege auf unsplash.com/developers ein Konto an, erstelle eine Anwendung („New Application“) " +
      "und kopiere den „Access Key“ hierher. Die Demo-Stufe erlaubt 50 Suchen in der Stunde und " +
      "reicht zum Ausprobieren.",
    helpUrl: "https://unsplash.com/developers",
    testable: true,
    fields: [
      {
        key: "accessKey",
        label: "Access Key",
        hint: "Die Zeichenkette aus deiner Unsplash-Anwendung, nicht der „Secret Key“.",
        secret: true,
        required: true,
        maxLength: 200,
      },
    ],
  },
  {
    provider: "photon",
    name: "Adressvorschläge in der Kasse",
    description:
      "Während der Kunde seine Straße tippt, schlägt die Kasse passende Adressen samt Postleitzahl " +
      "und Ort vor. Das spart Tippfehler und bricht weniger Käufe ab.",
    where: "Kasse im Shop",
    helpUrl: "https://photon.komoot.io",
    testable: true,
    defaultEnabled: true,
    fields: [],
  },
  {
    provider: "produktfeed",
    name: "Produktfeed",
    description:
      "Stellt alle Produkte als Datei bereit, wie Google Merchant Center, Meta und Preisvergleiche " +
      "sie lesen. Dieselbe Datei ist die Grundlage dafür, dass dein Shop in der KI-Suche auftaucht.",
    where: "Adresse unten kopieren und beim Dienst einreichen",
    setup:
      "Für Google brauchst du ein kostenloses Konto bei Google Merchant Center. Dort trägst du die " +
      "Adresse unten als geplanten Abruf ein, dann holt Google den Feed selbst, einmal am Tag.",
    helpUrl: "https://support.google.com/merchants/answer/7439058",
    testable: false,
    defaultEnabled: true,
    shopUrlPath: "/produkte.xml",
    fields: [],
  },
  {
    provider: "indexnow",
    name: "IndexNow",
    description:
      "Meldet Bing und Yandex sofort, wenn du ein Produkt veröffentlichst oder den Shop änderst. " +
      "Ohne das dauert es Tage, bis eine Suchmaschine von selbst vorbeischaut.",
    where: "Läuft im Hintergrund, sobald du etwas veröffentlichst",
    helpUrl: "https://www.indexnow.org",
    testable: false,
    defaultEnabled: true,
    fields: [],
  },
];

/** Findet eine Anbindung im Katalog. */
export function findIntegration(provider: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((i) => i.provider === provider);
}
