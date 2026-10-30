# STATUS

Stand: 30.10.2026

## Erledigt

- Repository angelegt, Arbeitsregeln in `CLAUDE.md`.
- `docs/01_Marktanalyse.md`: Vergleich Shopify, Shopware, commercetools, Medusa, Saleor, Vendure, ePages; Empfehlungen zu Architektur, Mandantentrennung, Datenmodell, Stack, Sicherheit, deutschen Pflichten.
- `docs/03_Architektur.md` plus ADR-001 bis ADR-008 in `docs/entscheidungen/`: Techstack, Module, API, Mandantentrennung, Ordnerstruktur, Betrieb, Qualität, Skalierung.
- `docs/04_Datenmodell.md` plus `db/schema_welle1.sql` (20 Schemas, 112 Tabellen, 93 davon mit Mandantentrennung per RLS) und `db/test_isolation.sh`: Isolationstest auf PostgreSQL 18.6 bestanden, inklusive lückenloser Nummernvergabe bei parallelen Bestellungen.
- `docs/05_Sicherheit.md`: Sicherheitskonzept mit Schutzgütern, Angreifern, 22 Bedrohungen (STRIDE), Maßnahmen je Bereich mit Priorität, Abdeckung von OWASP Top 10:2025 und API Top 10:2023, Plan für 21 automatische Sicherheitstests.
- Härtung der Datenbank (ADR-008): neue Rolle `shop_auth`, nur sie sieht Passwort-Hashes, Sitzungen und Einmalcodes. Neuer Rechtetest `db/test_sicherheit.sql` plus echte Zugriffsversuche, alles grün auf PostgreSQL 18.6, Gegenprobe erfolgreich.
- Antworten vom 28.10.2026 eingearbeitet: Better Auth bleibt, Rechnungen 10 Jahre, Zwei-Faktor für das Betreiberkonto schon in Welle 1.
- Nachträge erledigt: Architektur an Datenmodell Kapitel 7 angepasst (Backup-Rolle, Gutschrift als Belegart, Systemrollen im Code, processed_event, Mandantenbegriff in der Marktanalyse). Aufbewahrungsfrist geprüft: gesetzlich 8 Jahre, Kristof hat 10 Jahre gewählt.
- `docs/02_Featurekatalog.md`: alle Features aus den Featurelisten von ePages Now und ePages Store, ergänzt um neue Features, priorisiert nach Muss / Wäre gut / Vielleicht später und Wellen zugeordnet.
- `docs/06_Welle1_Anforderungen.md` (29.10.2026): alle 63 Funktionen der Welle 1 in Muss / Wäre gut / Vielleicht später zerlegt, 21 Querschnitts-Anforderungen, Bau-Reihenfolge in 26 Etappen mit „Fertig, wenn“, Zielablauf für das Ende von Welle 1. Recherche: Widerrufsbutton nach § 356a BGB (9 Anforderungen), Barrierefreiheitserklärung als neue Pflichtseite, GPSR-Angaben, Argon2id-Werte und pnpm-Wartezeit bestätigt, neue Better-Auth-Meldungen ausgewertet (IPv6-Kürzung für die Anfragebremse).
- Antworten vom 29.10.2026 eingearbeitet: Rechtstext-Vorlagen, unbezahlte Bestellungen verfallen nach 24 Stunden, Bestand erst bei Bestellung reservieren, Kleinunternehmerregelung später, schlichtes Design, Testshops Tee und Mode.
- **Etappe E1 Grundgerüst (29.10.2026):** pnpm-Monorepo mit Turborepo und gemeinsamen Einstellungen (`packages/config`), strenge Lieferkettenregeln in `pnpm-workspace.yaml`, Docker Compose mit Caddy (HTTPS, Sicherheits-Header), PostgreSQL 18.6, Garage (Objektspeicher mit öffentlichem und privatem Bereich) und Mailpit (mit Passwort). Alle Container ohne Administratorrechte. `pnpm dev` legt die `.env` mit Zufallspasswörtern an und startet alles mit einem Befehl. `pnpm check` bündelt Format, Lint, Typen, Tests, gitleaks, OSV-Scanner, `pnpm audit` und den Datenbanktest. CI auf GitHub Actions mit fünf Jobs, Dependabot wöchentlich. Getestet: 12 Werkzeug-Tests (inkl. Gegenprobe, dass gitleaks eingeschleuste Geheimnisse findet), 39 Prüfungen im Infrastruktur-Rauchtest, Datenbanktest grün, Kaltstart aus leerem Zustand in 16 Sekunden. Erster CI-Lauf auf GitHub: alle fünf Jobs grün.

- **Etappe E2 Kernel (30.10.2026):** Paket `packages/kernel` mit Geld-Typ (ganze Cent, nur gleiche Währung, Rundung nur ausdrücklich, Verteilen ohne Rundungsverlust, Anzeige „19,99 €“), Steuer in Basispunkten (Brutto/Netto, Netto + Steuer = Brutto exakt), UUIDv7 nach RFC 9562, Fehler im Format „Problem Details“ (unerwartete Fehler ohne Einzelheiten), Prüfung der Einstellungen beim Start (Meldungen ohne Werte, TLS-Pflicht außerhalb von `local`), Protokoll mit Schwärzung und gekürzten IP-Adressen, Anfrage-Kontext und `withTenantTransaction` (Pool eingeschlossen, ohne Mandant kein Datenbankkontakt). Neue ESLint-Regel: Datenbanktreiber `pg` nur im Kernel und in `identity`. Getestet: 94 Tests grün, davon 12 gegen eine echte PostgreSQL-Datenbank (Mandantentrennung, Rückrollen, kein Hängenbleiben des Mandanten an der Verbindung, 30 parallele Transaktionen, Wiederverbinden nach Verbindungsabbruch). **T-19 grün.** Gegenproben: Abgeschaltete Schwärzung und ein Mandant „für die ganze Sitzung“ statt „nur für die Transaktion“ werden von den Tests erkannt. Fund unterwegs: Ohne Fehler-Empfänger am Verbindungspool kann ein Datenbank-Neustart den ganzen Dienst abstürzen lassen; ist jetzt abgefangen und getestet. CI: neuer Schritt `pnpm test:with-db` mit Wegwerf-Datenbank PostgreSQL 18.6. Lokal liefen die Datenbanktests auf PostgreSQL 16 (kein Docker in der Cloud-Sitzung). Der CI-Lauf auf GitHub ist mit allen fünf Jobs grün, inklusive der Datenbanktests auf PostgreSQL 18.6.

## Nächste Schritte (in dieser Reihenfolge)

Die vollständige Bau-Reihenfolge mit 26 Etappen steht in `docs/06_Welle1_Anforderungen.md` Kapitel 5. Jeder Lauf nimmt die nächste offene Etappe.

1. **E3 Migrationen** (⚠ eventuell zwei Läufe): `db/schema_welle1.sql` auf die Module aufteilen, `migrate`-Dienst, Isolations- und Rechtetest in Testcontainers (ersetzt `tools/db-test.sh`), kysely-codegen je Modul, dependency-cruiser.
2. **E4 API-Gerüst** (siehe `docs/06_Welle1_Anforderungen.md` Kapitel 5). Nutzt `toProblemDetails`, `runWithContext` und `createLogger` aus dem Kernel.
3. **E5 Outbox und Hintergrundjobs.**

## Nachzutragen

- Wöchentlicher Container-Scan mit Trivy und SBOM (Sicherheit 5.11, Architektur 8.2): eigener geplanter CI-Ablauf, spätestens mit E4, wenn es eigene Container-Abbilder gibt.

- Mit E3: den Kernel-Test von der eigenen Demo-Tabelle auf das echte Schema umstellen.
- Mit E4: Sprache der Fehlertexte nach Antwort auf Frage 1 umsetzen.
- Vor E6: vollständige Liste der Better-Auth-Sicherheitsmeldungen auf GitHub lesen (bei der Recherche nicht erreichbar) und Mindestversion 1.6.11 oder neuer fest eintragen.
- Vor E15/E23: Angaben zur Button-Lösung (§ 312j BGB) gegen eine Quelle prüfen (Anforderungen 6.2).

## Offene Entscheidungen

Siehe `FRAGEN.md`.
