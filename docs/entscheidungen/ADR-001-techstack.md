# ADR-001: Tech-Stack

Status: angenommen. Datum: 27.10.2026. Details: `docs/03_Architektur.md`, Kapitel 2.

## Kontext

Die Plattform soll nur mit kostenloser, selbst hostbarer Open-Source-Technik gebaut werden. Claude schreibt den Code, Kristof ist kein Entwickler. Deshalb zählen Typprüfung, gute Testbarkeit, ausgereifte Bibliotheken und eine einzige Sprache für alle Teile mehr als Spitzenleistung.

## Entscheidung

- Sprache und Laufzeit: TypeScript auf Node.js 24 LTS, Paketverwaltung pnpm, Monorepo mit pnpm Workspaces und Turborepo.
- Kern: NestJS mit Fastify, Eingabeprüfung und OpenAPI aus Zod-Schemas.
- Daten: PostgreSQL 18, Zugriff mit Kysely, Typen mit kysely-codegen, Migrationen als SQL-Dateien pro Modul.
- Anmeldung: Better Auth für Betreiber und Händler, eigene API-Token mit Berechtigungen, Passwörter mit Argon2id.
- Hintergrund: pg-boss als Warteschlange in PostgreSQL.
- Dateien: S3-Schnittstelle mit Garage als Server, Bildverarbeitung mit sharp.
- Oberflächen: Storefront mit Astro (Server-Rendering, kleine React-Inseln), Backoffice und Plattform-Verwaltung mit React, Vite, TanStack, shadcn/ui und Tailwind CSS.
- Betrieb: Caddy als Reverse Proxy mit automatischem TLS, Docker Compose, Mailpit für Test-E-Mails.
- Qualität: Vitest, Testcontainers, Playwright, axe-core, Schemathesis, ESLint, Prettier, dependency-cruiser, OSV-Scanner, gitleaks, Trivy, GitHub Actions.

## Alternativen

- Next.js für die Storefront (Bewertung 3): mächtiger, aber komplexer beim Selbst-Hosten und Zwischenspeichern.
- Drizzle ORM (3) und Prisma (6) für den Datenbankzugriff: Drizzle wäre ebenfalls gut, Prisma erschwert den Mandanten pro Transaktion.
- Keycloak (5) oder Zitadel (4) für die Anmeldung: eigene schwere Dienste, für ein Lernprojekt zu aufwendig.
- BullMQ mit Valkey (4) als Warteschlange: ein Dienst mehr im Betrieb.
- MinIO (5) als Objektspeicher: Lizenz- und Vertriebsänderungen seit 2025 (zu prüfen).

## Folgen

- Alles ist eine Sprache, und Typen fließen von der Datenbank über die API bis in die Oberflächen.
- Mit PostgreSQL, Garage, Mailpit und den Programmen kommt Welle 1 mit wenigen Containern aus.
- Anmeldung und Objektspeicher liegen hinter eigenen Schnittstellen, damit ein späterer Wechsel des Werkzeugs nur ein Modul betrifft.
- Versionen werden beim Aufsetzen gegen die aktuelle stabile Fassung geprüft und fest eingetragen.

## Nachtrag 29.10.2026: Versionen beim Aufsetzen (Etappe E1)

Alle Versionen sind mindestens 7 Tage alt (Sicherheit 5.11) und fest eingetragen.

| Baustein | Version | Anmerkung |
|---|---|---|
| Node.js | 24.22.1 (LTS „Krypton“) | Node 26 ist seit Oktober 2026 ebenfalls LTS. Wechsel frühestens, wenn alle Bibliotheken ihn unterstützen. |
| pnpm | 12.15.0 | Lieferkettenregeln in `pnpm-workspace.yaml`: `minimumReleaseAge: 10080`, `minimumReleaseAgeStrict`, `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds` mit `allowBuilds` (ersetzt das frühere `onlyBuiltDependencies`) |
| TypeScript | 6.0.3 | TypeScript 7 (neuer, schneller Compiler) wird von typescript-eslint noch nicht unterstützt. Wechsel, sobald es das tut. |
| ESLint / typescript-eslint | 10.13 / 8.72 | |
| Turborepo | 2.11.10 | |
| PostgreSQL | 18.6 (Abbild `postgres:18.6-alpine`, Tests `postgres:18.6`) | |
| Caddy | 2.11.7 | |
| Garage | 2.4.1 | 2.5.0 war beim Aufsetzen jünger als 7 Tage |
| Mailpit | 1.32.0 | |
| gitleaks / OSV-Scanner | 8.30.1 / 2.7.0 | Download mit Prüfsumme über `tools/ensure-tool.sh` |

Container-Abbilder sind zusätzlich mit ihrer Prüfsumme (digest) eingetragen.

## Nachtrag 30.10.2026: Bausteine des Kernels (Etappe E2)

Neue Pakete, alle mindestens 7 Tage alt und fest eingetragen. Jedes wird gebraucht und ersetzt Eigenbau:

| Paket | Version | Wofür |
|---|---|---|
| zod | 4.6.7 | Prüfschemas für Eingaben, Geld und Einstellungen |
| pino | 10.4.0 | Technische Protokolle (Schwärzung kommt aus dem Kernel) |
| kysely | 0.29.7 | Typsichere Abfragen und Transaktionen |
| pg | 8.23.1 | PostgreSQL-Treiber unter Kysely (nur im Kernel und im Modul `identity` erlaubt, ESLint-Regel) |
| vitest | 5.0.5 | Unit- und Integrationstests (nur zur Entwicklung) |
| @types/pg | 8.23.1 | Typen für den Treiber (nur zur Entwicklung) |
