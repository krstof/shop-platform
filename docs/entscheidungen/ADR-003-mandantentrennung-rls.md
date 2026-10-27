# ADR-003: Mandantentrennung mit gemeinsamem Schema und PostgreSQL-RLS

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 5.

## Kontext

Viele Shops teilen sich eine Plattform. Kein Shop darf jemals Daten eines anderen sehen oder ändern. Fehler bei der Zugriffskontrolle stehen bei OWASP auf Platz 1 der häufigsten Schwachstellen. Eine Prüfung nur im Anwendungscode reicht nicht, weil ein einziger vergessener Filter genügt, um Daten preiszugeben.

## Entscheidung

- Ein Mandant ist ein Shop. Alle Shops teilen sich dieselben Tabellen, und jede Tabelle mit Shopdaten hat die Spalte `tenant_id`.
- Auf jeder dieser Tabellen ist Row-Level-Security mit `ENABLE` und `FORCE` aktiv. Die Policy vergleicht `tenant_id` mit dem Wert `app.tenant_id` der laufenden Transaktion, für Lesen (`USING`) und Schreiben (`WITH CHECK`). Ohne gesetzten Mandanten liefert eine Abfrage keine Zeilen.
- Der Mandant wird ausschließlich über `withTenantTransaction` mit `set_config('app.tenant_id', ..., true)` gesetzt, also nur für die Dauer einer Transaktion.
- Die Anwendung verbindet sich mit Rollen ohne `SUPERUSER` und ohne `BYPASSRLS`. Der Plattform-Betreiber hat einen eigenen, begrenzten Zugang. Support-Zugriff auf einen Shop läuft über protokollierte, zeitlich begrenzte Impersonation, die ebenfalls RLS nutzt.
- Automatische Tests prüfen jede Tabelle und jeden Endpunkt mit zwei Testshops auf Datenlecks. Tabellen ohne Mandant stehen mit Begründung in `db/global-tables.yaml`.

## Alternativen

- Ein Datenbankschema pro Shop: bessere Trennung, aber Migrationen müssen tausendfach laufen, und das skaliert schlecht.
- Eine Datenbank pro Shop: stärkste Trennung, aber teuer und aufwendig im Betrieb.
- Filter nur im Anwendungscode: einfach, aber ein einziger Fehler führt zum Datenleck.

## Folgen

- Selbst fehlerhafter Anwendungscode kann keine fremden Shopdaten lesen.
- Jeder Index beginnt mit `tenant_id`, und Verweise innerhalb eines Moduls nutzen zusammengesetzte Schlüssel aus `(tenant_id, id)`.
- Große Shops lassen sich später per logischer Replikation in eine eigene Datenbank umziehen oder per Citus verteilen, weil `tenant_id` überall vorhanden ist.
