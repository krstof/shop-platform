# ADR-004: REST-APIs mit OpenAPI als Quelle der Wahrheit

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 4.

## Kontext

Die Plattform folgt dem Grundsatz „API-first“: Jede Funktion ist zuerst eine Schnittstelle, und Oberflächen, Partner und die KI nutzen dieselbe API. Die KI soll ihre Werkzeuge aus derselben Beschreibung bekommen wie die Oberflächen ihre Typen.

## Entscheidung

- Es gibt drei getrennte REST-APIs: Platform API (`/platform/v1`), Admin API (`/admin/v1`) und Storefront API (`/store/v1`).
- Die OpenAPI-Beschreibung entsteht aus den Zod-Schemas im Code, wird eingecheckt und ist die Quelle für Dokumentation, API-Client, Vertragstests und MCP-Werkzeuge.
- Konventionen: Hauptversion im Pfad, nur abwärtskompatible Änderungen innerhalb einer Version (geprüft mit oasdiff), Cursor-Paginierung, `Idempotency-Key` für `POST` (Pflicht bei Checkout und Zahlung), `ETag` und `If-Match` gegen gleichzeitiges Überschreiben, Fehler nach RFC 9457, Geld als `{ amount, currency }`.
- Jeder Endpunkt erklärt seine nötigen Berechtigungen (`x-required-scopes`) und seine KI-Freigabe (`x-mcp-expose`, `x-mcp-confirm`).
- Webhooks für Partner (Welle 4) folgen der Spezifikation „Standard Webhooks“ mit HMAC-Signatur.

## Alternativen

- GraphQL (Bewertung 3): flexibel für Frontends, aber schwerer abzusichern (teure Abfragen), schwerer zwischenzuspeichern und weniger direkt in KI-Werkzeuge übersetzbar.
- Eine einzige API für alle Zwecke: einfacher, aber die öffentliche Storefront und die Händlerfunktionen hätten dann dieselbe Angriffsfläche.

## Folgen

- Oberflächen und KI können die API nicht an der Beschreibung vorbei benutzen, und Abweichungen fallen in der CI auf.
- Wenn ein Frontend später viele kleine Abfragen braucht, kann ein GraphQL-Zugang zusätzlich auf denselben Fassaden entstehen.
