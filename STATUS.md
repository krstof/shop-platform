# STATUS

Stand: 27.10.2026

## Erledigt

- Repository angelegt, Arbeitsregeln in `CLAUDE.md`.
- `docs/01_Marktanalyse.md`: Vergleich Shopify, Shopware, commercetools, Medusa, Saleor, Vendure, ePages; Empfehlungen zu Architektur, Mandantentrennung, Datenmodell, Stack, Sicherheit, deutschen Pflichten.
- `docs/03_Architektur.md` plus ADR-001 bis ADR-007 in `docs/entscheidungen/`: Techstack, Module, API, Mandantentrennung, Ordnerstruktur, Betrieb, Qualität, Skalierung.
- `docs/04_Datenmodell.md` plus `db/schema_welle1.sql` (20 Schemas, 112 Tabellen, 93 davon mit Mandantentrennung per RLS) und `db/test_isolation.sh`: Isolationstest auf PostgreSQL 18.6 bestanden, inklusive lückenloser Nummernvergabe bei parallelen Bestellungen.
- `docs/02_Featurekatalog.md`: alle Features aus den Featurelisten von ePages Now und ePages Store, ergänzt um neue Features, priorisiert nach Muss / Wäre gut / Vielleicht später und Wellen zugeordnet.

## Nächste Schritte (Welle 0, in dieser Reihenfolge)

1. **Sicherheitskonzept** `docs/05_Sicherheit.md`: Bedrohungen, Maßnahmen, automatische Tests.
2. **Anforderungskatalog Welle 1** `docs/06_Welle1_Anforderungen.md`: je Feature Muss / Wäre gut / Vielleicht später, aufwendige Punkte markiert, Fragen an Kristof.
3. Danach Welle 1: Grundgerüst des Codes (Docker Compose, Datenbank, API-Gerüst, Isolationstest).

## Nachzutragen

- `docs/03_Architektur.md` an die Abweichungen aus `docs/04_Datenmodell.md` Kapitel 7 anpassen (Backup-Rolle mit BYPASSRLS, Gutschrift als Dokumenttyp, Systemrollen im Code, processed_event nur in hörenden Modulen, Begriff tax_class). Kann im Lauf zum Sicherheitskonzept miterledigt werden.
- Aufbewahrungsfrist für Rechnungen prüfen (10 vs. 8 Jahre nach Viertem Bürokratieentlastungsgesetz).

## Offene Entscheidungen

Siehe `FRAGEN.md`.
