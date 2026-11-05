# @shop/kernel

Gemeinsamer Werkzeugkasten aller Module (Architektur 3.2). Der Kernel kennt kein Fachmodul.

| Datei | Inhalt | Regeln |
|---|---|---|
| `money.ts`, `rounding.ts` | Geld als ganze Zahl in der kleinsten Einheit plus Währung, Rechnen nur bei gleicher Währung, Rundung nur ausdrücklich (`half_up`, `half_even`), Verteilen ohne Rundungsverlust, Anzeige „19,99 €“ | ADR-006, Q-08 |
| `tax.ts` | Steuer aus Brutto und Netto in Basispunkten (1900 = 19 %), kaufmännisch gerundet, Netto + Steuer = Brutto exakt | Datenmodell 2.11, STR-01 |
| `id.ts` | UUIDv7 nach RFC 9562, auch innerhalb einer Millisekunde aufsteigend, Prüfschemas | Datenmodell 2.2 |
| `problem.ts`, `problem-texts.ts`, `locale.ts` | Fehler im Format „Problem Details“ (RFC 9457), unerwartete Fehler ohne Einzelheiten, Zod-Fehler als Feldfehler mit JSON Pointer (unbekannte Felder einzeln); Titel und Feldtexte auf Deutsch oder Englisch nach `Accept-Language` (`pickLocale`, `zodErrorMap`), Deutsch als Standard | Architektur 4.9, Q-05, Entscheidung 30.10.2026 |
| `config.ts` | Prüfung der Umgebungsvariablen beim Start, Geheimnisse mindestens 32 Zeichen, kein Platzhalter, TLS zur Datenbank außerhalb von `local`; Meldungen nennen nur Namen, nie Werte | Sicherheit 5.10 und 5.13 |
| `logger.ts`, `ip.ts` | pino mit zentraler Schwärzung von Passwörtern, Tokens, Cookies, Zahlungsdaten in jeder Tiefe, in Freitext und in Kind-Protokollen; IP-Adressen gekürzt (IPv4 /24, IPv6 /48, Anfragebremse /64); `requestId` und `tenantId` in jeder Zeile | Sicherheit 5.12, Q-16, T-19 |
| `context.ts` | Anfrage-Kontext (Mandant, Akteur, requestId) über `AsyncLocalStorage` | Architektur 5.3 |
| `db/migrate.ts` (Unterpfad `@shop/kernel/migrate`) | Migrationslauf: `db/roles.sql`, SCRAM-Passwörter, Prüfsummen, alle Migrationen in einer Transaktion als `shop_owner`, Sperre gegen gleichzeitige Läufe. Nur für den Dienst `apps/migrate` | Architektur 6.1, BET-01 |
| `migrations/` | Migrationen des Kernels (Schema `kernel`) | Architektur 6.1 |
| `db/database.ts` | `connectDatabase`, `withTenantTransaction`, `withPlatformTransaction`. Kysely und Pool sind eingeschlossen; ohne Mandant wird die Datenbank gar nicht erst gefragt | Architektur 5.3, PLA-03 |
| `events/event.ts` | `defineEvent` (Name `<modul>.<sache>.<vergangenheit>.v<n>`, nur `z.strictObject`), `publishEvent` schreibt in derselben Transaktion nach `kernel.outbox`; Shop aus der Transaktion, Urheber, `correlationId` und `causationId` aus dem Kontext. Vereinbarung: `data.id` = Objekt, `data.changes` = `{ feld: [alt, neu] }` | ADR-007, E5 |
| `events/subscriber.ts` | `defineSubscriber` (Name `<schema>.<name>`, Ereignisliste oder `"*"`); `deliverEvent` (nur `@shop/kernel/worker`): Inbox `<schema>.processed_event` und Wirkung in einer Transaktion, also genau einmal | ADR-007, E5 |
| `events/relay.ts`, `jobs/queue.ts`, `jobs/cleanup.ts` (Unterpfad `@shop/kernel/worker`) | Relay: Outbox lesen (`FOR UPDATE SKIP LOCKED`), je Subscriber eine Aufgabe in pg-boss (Job-ID = Ereignis-ID), markieren, alles in einer Transaktion als `shop_relay`. Warteschlange: pg-boss ohne eigene Schemaänderungen, prüft die Schema-Version, 10 Wiederholungen mit wachsenden Abständen, je Aufgabe einzeln quittiert. Aufräumen: abgelaufene Idempotenz-Schlüssel, veröffentlichte Ereignisse nach 30 Tagen | BET-05, E5 |
| `scripts/pgboss-schema.mjs` | Erzeugt die Migration `20261105T060000_create_pgboss.sql` aus pg-boss selbst; ein Test prüft, dass sie zur installierten Version passt | E5 |

Tests: `pnpm --filter @shop/kernel test`. Die Datenbanktests brauchen `SHOP_TEST_DATABASE_URL`;
`pnpm test:with-db` startet dafür eine Wegwerf-Datenbank PostgreSQL 18.6 in Docker.
