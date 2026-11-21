# Modul `integrations`

> Landkarte für spätere Läufe (Architektur 8.4). Code seit 21.11.2026 (Paket `@shop/integrations`), Fassade in `src/index.ts`.

**Aufgabe:** Anbindungen an fremde Dienste je Shop. Hält fest, welche Anbindung eingeschaltet ist, welche offenen Einstellungen sie hat und welche Zugangsdaten hinterlegt sind, prüft die Verbindung und schickt dem Händler Nachrichten über den eingeschalteten Weg.

**Welle:** 2

**Datenbankschema:** `integrations`, Tabelle: `connection`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): nichts. Das Modul kennt kein anderes; andere holen sich hier ihre Zugangsdaten.

**Fassade:** `createIntegrations({ database, secretBox })` mit `list()`, `get(provider)`, `credentials(provider)`, `save(...)`, `recordCheck(...)`, `notifyMerchant(text)`. Dazu `INTEGRATIONS` (Katalog), `integrationEndpoints(...)` und `fetchExternal(...)`.

**Zugangsdaten:** verschlüsselt in `connection.secrets` (Umschlagverschlüsselung, `packages/kernel/src/secret-box.ts`). Der Hauptschlüssel steht nur in der Serverkonfiguration (`SHOP_MASTER_KEY_V1`). Der Zweck bindet jeden Wert an Shop und Dienst. Geheime Werte gehen nie an den Browser zurück, die API meldet nur „hinterlegt“.

**Eine neue Anbindung hinzufügen:**
1. Eintrag in `src/catalog.ts` (Name, Erklärung, Felder, ob prüfbar).
2. Falls prüfbar: Funktion in `src/internal/checks.ts` ergänzen.
3. Fertig. Die Seite „Einstellungen → Anbindungen“ im Backoffice baut sich aus dem Katalog; dort ist nichts zu ändern.

**Weg nach außen:** Jeder Aufruf eines fremden Dienstes geht durch `fetchExternal` (`src/internal/outbound.ts`): Zeitlimit, eine Wiederholung bei 429 und 5xx, Größenbegrenzung der Antwort und Fehlermeldungen in Alltagssprache.
