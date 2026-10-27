# STATUS

Stand: 27.10.2026

## Erledigt

- Repository angelegt, Arbeitsregeln in `CLAUDE.md`.
- `docs/01_Marktanalyse.md`: Vergleich Shopify, Shopware, commercetools, Medusa, Saleor, Vendure, ePages; Empfehlungen zu Architektur, Mandantentrennung, Datenmodell, Stack, Sicherheit, deutschen Pflichten.
- `docs/02_Featurekatalog.md`: alle Features aus den Featurelisten von ePages Now und ePages Store, ergänzt um neue Features, priorisiert nach Muss / Wäre gut / Vielleicht später und Wellen zugeordnet.

## Nächste Schritte (Welle 0, in dieser Reihenfolge)

1. **Architektur-Dokument** `docs/03_Architektur.md`: Module und ihre Grenzen, API-Design, Mandantentrennung mit Row-Level-Security, Ordnerstruktur des Codes. Wichtige Entscheidungen zusätzlich als ADR in `docs/entscheidungen/`.
2. **Datenmodell** `docs/04_Datenmodell.md`: alle Tabellen für Welle 1 plus vorbereitete Tabellen für B2B, Internationalisierung, Varianten (keine Sackgassen).
3. **Sicherheitskonzept** `docs/05_Sicherheit.md`: Bedrohungen, Maßnahmen, automatische Tests.
4. **Anforderungskatalog Welle 1** `docs/06_Welle1_Anforderungen.md`: je Feature Muss / Wäre gut / Vielleicht später, aufwendige Punkte markiert, Fragen an Kristof.
5. Danach Welle 1: Grundgerüst des Codes (Docker Compose, Datenbank, API-Gerüst, Isolationstest).

## Offene Entscheidungen

Siehe `FRAGEN.md`.
