# STATUS

Stand: 29.10.2026

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

## Nächste Schritte (in dieser Reihenfolge)

Die vollständige Bau-Reihenfolge mit 26 Etappen steht in `docs/06_Welle1_Anforderungen.md` Kapitel 5. Jeder Lauf nimmt die nächste offene Etappe.

1. **E1 Grundgerüst:** Monorepo (pnpm, Turborepo), Docker Compose mit Caddy, PostgreSQL, Garage, Mailpit, `.env`-Erzeugung, CI mit gitleaks, OSV-Scanner und `pnpm audit`, pnpm-Lieferkettenregeln (`minimumReleaseAge: 10080`, `onlyBuiltDependencies`). Versionen beim Aufsetzen gegen die aktuelle stabile Fassung prüfen.
2. **E2 Kernel:** Geld, Steuer-Basispunkte, UUIDv7, Problem Details, Konfigurationsprüfung, Protokoll mit Schwärzung, `withTenantTransaction`.
3. **E3 Migrationen:** Schema auf Module aufteilen, Isolations- und Rechtetest in Testcontainers.

## Nachzutragen

- Vor E6: vollständige Liste der Better-Auth-Sicherheitsmeldungen auf GitHub lesen (bei der Recherche nicht erreichbar) und Mindestversion 1.6.11 oder neuer fest eintragen.
- Vor E15/E23: Angaben zur Button-Lösung (§ 312j BGB) gegen eine Quelle prüfen (Anforderungen 6.2).

## Offene Entscheidungen

Siehe `FRAGEN.md`.
