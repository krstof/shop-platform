# STATUS

Stand: 28.10.2026

## Erledigt

- Repository angelegt, Arbeitsregeln in `CLAUDE.md`.
- `docs/01_Marktanalyse.md`: Vergleich Shopify, Shopware, commercetools, Medusa, Saleor, Vendure, ePages; Empfehlungen zu Architektur, Mandantentrennung, Datenmodell, Stack, Sicherheit, deutschen Pflichten.
- `docs/03_Architektur.md` plus ADR-001 bis ADR-008 in `docs/entscheidungen/`: Techstack, Module, API, Mandantentrennung, Ordnerstruktur, Betrieb, Qualität, Skalierung.
- `docs/04_Datenmodell.md` plus `db/schema_welle1.sql` (20 Schemas, 112 Tabellen, 93 davon mit Mandantentrennung per RLS) und `db/test_isolation.sh`: Isolationstest auf PostgreSQL 18.6 bestanden, inklusive lückenloser Nummernvergabe bei parallelen Bestellungen.
- `docs/05_Sicherheit.md`: Sicherheitskonzept mit Schutzgütern, Angreifern, 22 Bedrohungen (STRIDE), Maßnahmen je Bereich mit Priorität, Abdeckung von OWASP Top 10:2025 und API Top 10:2023, Plan für 21 automatische Sicherheitstests.
- Härtung der Datenbank (ADR-008): neue Rolle `shop_auth`, nur sie sieht Passwort-Hashes, Sitzungen und Einmalcodes. Neuer Rechtetest `db/test_sicherheit.sql` plus echte Zugriffsversuche, alles grün auf PostgreSQL 18.6, Gegenprobe erfolgreich.
- Nachträge erledigt: Architektur an Datenmodell Kapitel 7 angepasst (Backup-Rolle, Gutschrift als Belegart, Systemrollen im Code, processed_event, Mandantenbegriff in der Marktanalyse). Aufbewahrungsfrist geprüft: gesetzlich 8 Jahre (Entscheidung offen, Frage 2).
- `docs/02_Featurekatalog.md`: alle Features aus den Featurelisten von ePages Now und ePages Store, ergänzt um neue Features, priorisiert nach Muss / Wäre gut / Vielleicht später und Wellen zugeordnet.

## Nächste Schritte (in dieser Reihenfolge)

1. **Anforderungskatalog Welle 1** `docs/06_Welle1_Anforderungen.md`: je Feature Muss / Wäre gut / Vielleicht später, aufwendige Punkte markiert, Muss-Maßnahmen aus `docs/05_Sicherheit.md` als Anforderungen eingearbeitet, feste Bau-Reihenfolge, Fragen an Kristof.
2. Danach Welle 1: Grundgerüst des Codes (Docker Compose, Datenbank, API-Gerüst, Isolationstest und Sicherheitstest in Testcontainers, CI mit gitleaks und OSV-Scanner).

## Nachzutragen

- Antworten auf die Fragen 1 bis 3 aus `FRAGEN.md` in `docs/05_Sicherheit.md` und `docs/04_Datenmodell.md` einarbeiten.
- Die mit „zu prüfen“ markierten Punkte im Sicherheitskonzept (Argon2id-Werte, pnpm `minimumReleaseAge`, Liste der Better-Auth-Sicherheitsmeldungen) beim Bau der jeweiligen Funktion nachschlagen.

## Offene Entscheidungen

Siehe `FRAGEN.md`.
