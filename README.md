# shop-platform

Shop-Plattform im Stil von ePages oder Shopify: privates Lern-Experiment, ohne echte Händler, Kunden oder Zahlungen.

- Arbeitsregeln: `CLAUDE.md`
- Fortschritt und nächster Schritt: `STATUS.md`
- Offene Fragen: `FRAGEN.md`
- Konzepte: `docs/` (Marktanalyse, Featurekatalog, Architektur, Datenmodell, Sicherheit, Anforderungen Welle 1)

## Befehle (für Claude)

Kristof muss keinen dieser Befehle selbst ausführen.

| Befehl | Wirkung |
|---|---|
| `pnpm dev` | legt `.env` mit Zufallspasswörtern an, startet alle Container, richtet den Objektspeicher ein, legt die Datenbank an und führt alle Migrationen aus |
| `pnpm dev:down` | stoppt die Container (Daten bleiben) |
| `pnpm check` | alle Prüfungen vor einem Commit: Format, Lint, Typen, Tests, Geheimnisse, Abhängigkeiten, Datenbank |
| `pnpm test:infra` | Rauchtest der laufenden Container (HTTPS, Header, Speicher, Härtung) |
| `pnpm openapi` | schreibt die OpenAPI-Dateien unter `openapi/` neu (`--check` prüft nur, wie in der CI) |
| `pnpm test:db` | Wegwerf-Datenbank mit dem Dienst migrate einrichten, dann Isolations- und Rechtetest |

Voraussetzungen: Node.js 24.22.1, pnpm 12.15.0, Docker mit Compose.

Lokale Adressen: `https://localhost`, `https://mail.localhost` (Test-Mails), `https://media.localhost` (Bilder).
