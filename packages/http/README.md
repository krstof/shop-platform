# @shop/http

Vertrag für Endpunkte (Architektur 4, ADR-009). Module beschreiben ihre Endpunkte hiermit, `apps/api` macht daraus Routen und OpenAPI.

| Datei | Inhalt | Regeln |
|---|---|---|
| `endpoint.ts` | `defineEndpoint`: API, Methode, Pfad, `operationId`, Berechtigung, Zod-Schemas, Funktion. Prüft beim Laden: Berechtigung vorhanden (öffentlich nur in der Storefront-API mit Begründung), Eingaben streng auf allen Ebenen, Platzhalter passen zum Pfad-Schema, kein Inhalt bei GET und DELETE | Q-02, Q-03, ADR-009 |
| `scopes.ts` | Geschlossene Liste der Berechtigungen (`products:read` usw.) | Architektur 4.4, Sicherheit 5.3 |
| `pagination.ts` | `listQuery` (limit 1 bis 100, Standard 25, `cursor`), `pageOf`, `toPage`, Cursor als Base64url-JSON; kaputter Cursor ergibt 422 | Architektur 4.7, Q-07 |
| `schemas.ts` | `idParam` (UUID), `timestamp` (ISO 8601 UTC), `singleLineText` und `multiLineText` (Höchstlänge, keine Steuerzeichen), `problemSchema` (RFC 9457) | Architektur 4.8, 4.9, Sicherheit 5.4 |

Beispiel: `modules/catalog/src/http/admin/manufacturers.ts`.

Regeln für neue Endpunkte:

1. Eingaben mit `z.strictObject`, nie mit `z.object` (sonst startet die API nicht).
2. Felder wie `tenantId`, `id`, `status`, `version`, `createdBy` gehören nie in ein Eingabeschema.
3. Ausgaben mit `z.object`: Felder, die nicht im Schema stehen, werden entfernt und gehen nie hinaus.
4. Datenbankzugriff nur über `withTenantTransaction`; der Mandant kommt aus dem Anfrage-Kontext.
5. Nicht gefunden und fremder Shop sind dasselbe: `throw new NotFoundError()`.
6. Jeder Endpunkt mit Inhalt braucht ein `bodyExample`. Texte mit `singleLineText(max)` oder `multiLineText(max)`.
7. Änderungen an bestehenden Datensätzen mit `ifMatch: "required"`; Checkout, Zahlung und Erstattung mit `idempotency: "required"`.
8. Neuer Pfad-Platzhalter: Testfabrik in `apps/api/src/testing/t08-fixtures.ts` ergänzen (sonst scheitert T-08).
9. Danach `pnpm openapi` ausführen und die geänderten Dateien unter `openapi/` einchecken.
