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
];

/** Findet eine Anbindung im Katalog. */
export function findIntegration(provider: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((i) => i.provider === provider);
}
