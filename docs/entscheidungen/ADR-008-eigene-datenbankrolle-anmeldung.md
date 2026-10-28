# ADR-008: Eigene Datenbankrolle für das Anmeldemodul

Status: angenommen. Datum: 28.10.2026. Details: `docs/05_Sicherheit.md`, Kapitel 8.

## Kontext

Die Anmeldetabellen (`identity.user`, `account`, `session`, `verification`, `two_factor`, `passkey`) sind global, weil eine Person mehrere Shops haben kann. Sie haben deshalb keine `tenant_id` und keine RLS. Bisher durfte die Anwendungsrolle `shop_app` sie vollständig lesen und schreiben. Ein einziger Fehler irgendwo im Kern, etwa eine SQL-Injection, hätte so die Passwort-Hashes und Sitzungen aller Händler preisgeben oder Konten übernehmen lassen.

## Entscheidung

- Es gibt eine eigene Datenbankrolle `shop_auth` (ohne `SUPERUSER`, ohne `BYPASSRLS`). Nur sie darf die sechs Anmeldetabellen lesen und schreiben. Auf alle anderen Tabellen hat sie keinerlei Rechte.
- Better Auth läuft im Modul `identity` mit einem eigenen, kleinen Verbindungspool als `shop_auth`. Dieser Pool ist nur innerhalb des Moduls sichtbar.
- `shop_app` und `shop_platform` dürfen von `identity.user` nur unkritische Spalten lesen (ID, E-Mail, Name, Bild, Sprache, Status, für die Plattform zusätzlich Sperre und Anlagedatum). Anlegen, Sperren und Passwort zurücksetzen laufen über die Fassade des Moduls `identity`.
- Mitgliedschaften, Rollen und API-Token bleiben Mandantentabellen mit RLS unter `shop_app`.
- `db/test_sicherheit.sql` prüft bei jeder Änderung, dass keine andere Rolle Rechte auf die Anmeldegeheimnisse hat.

## Alternativen

- Alles unter `shop_app` lassen und auf sorgfältigen Code vertrauen: einfach, aber ein Fehler genügt für ein Leck aller Konten.
- Ein eigener Anmeldedienst mit eigener Datenbank (zum Beispiel Zitadel oder Keycloak): stärkste Trennung, aber ein schwerer Zusatzdienst (Architektur 2.2).
- RLS auf den Anmeldetabellen über `app.user_id`: schützt nicht vor dem Login-Ablauf selbst, der Nutzer per E-Mail suchen muss, und wäre schwer verständlich.

## Folgen

- Die Regel „einziger Weg zur Datenbank ist `withTenantTransaction`“ bekommt genau eine Ausnahme: den Pool des Anmeldemoduls. Eine ESLint-Regel erlaubt ihn nur innerhalb von `modules/identity`.
- Die Plattform-Verwaltung legt Händlerkonten über die Fassade von `identity` an, nicht direkt per SQL.
- Ein Wechsel von Better Auth zu einem anderen Anmeldebaustein betrifft nur das Modul `identity` und die Rolle `shop_auth`.
