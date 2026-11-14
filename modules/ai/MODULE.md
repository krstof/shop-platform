# Modul `ai`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit 14.11.2026 (KI-Chat, Welle 2). Fassade in `src/index.ts`.

**Aufgabe:** KI-Assistent für Händler: Chat mit einem Sprachmodell, Werkzeuge aus der Admin-API, Änderungen nur nach Bestätigung.

**Welle:** 2

**Datenbankschema:** `ai`, Tabelle `usage_day` (Antworten und Tokens je Shop und Tag, für das Tageslimit). Unterhaltungen werden nicht gespeichert, das Backoffice hält sie im Browser-Tab.

**Darf aufrufen** (`module.json` → `dependsOn`): nichts. Die Werkzeuge laufen im Backoffice über die normale Admin-API (`apps/backoffice/src/lib/assistant.ts`), mit den Rechten der angemeldeten Person.

**Heute:** `GET /admin/v1/assistant` (eingerichtet?, Tageslimit, Werkzeuge mit `changes`), `POST /admin/v1/assistant/chat` (Verlauf rein, Text und Werkzeugaufrufe raus; 429 beim Tageslimit, 503 ohne Modell). Fotos als Bildbaustein `image` (nur in Nachrichten der Person, höchstens 2 je Anfrage); Werkzeuge `create_product` mit `photo` und `add_product_photo`, das Hochladen macht das Backoffice. Probefrage nach dem Einrichten: `apps/api/src/assistant-check.ts`. Anweisungen (`SYSTEM_PROMPT`) und Werkzeuge (`TOOLS`) stehen fest auf dem Server. Modell hinter `AssistantModel`: `anthropicModel` (Messages-API per fetch, kein SDK), `scriptedModel` für Tests. Einstellungen: `SHOP_ASSISTANT_API_KEY`, `SHOP_ASSISTANT_MODEL` (Standard `claude-sonnet-5-5`), `SHOP_ASSISTANT_BASE_URL` (auf dem Server der Ausgang über Caddy `http://10.213.17.200:8095`), `SHOP_ASSISTANT_DAILY_LIMIT` (Standard 300).

**Geplant (Architektur 3.2):** Unterhaltungen und Änderungsvorschläge speichern (`conversation`, `message`, `action_proposal`), Ereignis `ai.proposal.confirmed.v1`, Kennzeichnung „durch Assistent“ im Änderungsprotokoll, MCP-Server.

**Achtung bei neuen Werkzeugen:** Die Werkzeugnamen stehen als Aufzählung (enum) in Anfrage und Antwort von `chatWithAssistant`. Ein neues Werkzeug meldet die Bruchprüfung (oasdiff) deshalb als Bruch, so am 14.11.2026 mit `add_product_photo` (CI einmal rot). Beim nächsten neuen Werkzeug die Namen in der Antwort einmalig auf `x-extensible-enum` umstellen und die Bausteine als benannte Schemas (`meta({ id })`) führen; das meldet oasdiff dann ein letztes Mal.
