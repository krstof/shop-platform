# ADR-005: Shop-Editor speichert Abschnitte und Bausteine als JSON

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 3 (Modul `storefront`).

## Kontext

Händler sollen das Aussehen ihres Shops mit einem visuellen Editor gestalten, und die KI soll Seiten nach einer Beschreibung bauen können. Freies HTML wäre unsicher, weil eingeschleuster Code Kundendaten abgreifen könnte (Cross-Site-Scripting), und es ließe sich weder sauber versionieren noch beim Designwechsel übernehmen.

## Entscheidung

- Eine Seite oder Vorlage ist ein JSON-Dokument aus einer geordneten Liste von Abschnitten (Sections). Jeder Abschnitt hat `id`, `type`, `settings` und eine Liste von Bausteinen (Blocks) mit ebenfalls `id`, `type` und `settings`. Ein Feld `schemaVersion` erlaubt spätere Umstellungen.
- Die erlaubten Typen und ihre Einstellungen sind im Code in `packages/storefront-sections` mit Zod-Schemas festgelegt. Dieselben Schemas prüfen jede Speicherung, erzeugen die Formulare im Editor und dienen der KI als Werkzeugbeschreibung.
- Formatierter Text wird als strukturierte Daten gespeichert und über eine Liste erlaubter Elemente dargestellt. Eigenes HTML, CSS oder JavaScript gibt es nicht.
- Jede Seite hat einen Entwurf und veröffentlichte Versionen in `template_version`. Die KI erzeugt nur Entwürfe.
- Auch die einfachen Textseiten aus Welle 1 werden schon in diesem Format gespeichert.

## Alternativen

- Gespeichertes HTML aus einem Baukasten: unsicher und schlecht wartbar.
- Ein fertiger Seitenbaukasten wie GrapesJS oder Puck: möglich als Editor-Oberfläche in Welle 2, aber das Datenformat bleibt unser eigenes.

## Folgen

- Seiten sind sicher, versionierbar, beim Designwechsel übertragbar und von der KI gut erzeugbar.
- Was ein Händler gestalten kann, ist auf die vorhandenen Bausteine begrenzt. Neue Gestaltungsmöglichkeiten entstehen als neue Bausteintypen.
