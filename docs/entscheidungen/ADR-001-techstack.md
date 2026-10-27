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
