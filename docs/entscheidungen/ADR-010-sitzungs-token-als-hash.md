# ADR-010: Sitzungs-Token nur als Hash, Better Auth nur hinter eigener Schnittstelle

Status: angenommen. Datum: 06.11.2026. Bezug: Sicherheit 5.2 (B-04), ADR-008, Etappe E6 Teil 1.

## Kontext

Better Auth (Version 1.7.14) speichert das Sitzungs-Token im Klartext in der Tabelle `session`, dasselbe Token steckt im Cookie. Wer die Tabelle lesen kann, etwa über ein gestohlenes Backup, hätte sofort gültige Anmeldungen aller Händler. Das Sicherheitskonzept verlangt deshalb „in der Datenbank nur der SHA-256-Hash des Cookies“. Better Auth hat dafür keine Einstellung.

Außerdem hatte Better Auth von 2024 bis Oktober 2026 insgesamt 26 Sicherheitsmeldungen, mehrere davon zu Pfad-Schreibweisen, der eingebauten Bremse und Plugins.

## Entscheidung

1. **Hülle um den Datenbank-Adapter** (`modules/identity/src/internal/hashed-session-adapter.ts`): Jedes Token, das Better Auth in die Tabelle `session` schreiben oder dort suchen will, wird vorher durch seinen SHA-256-Hash ersetzt. Better Auth merkt davon nichts. Teilsuchen im Token und Ändern des Tokens sind verboten.
2. **Kein HTTP-Teil von Better Auth nach außen.** Das Modul ruft Better Auth nur auf dem Server auf (`auth.api.*`). Die Endpunkte für Anmelden und Abmelden baut das Modul selbst, mit eigener Bremse, Zod-Prüfung und OpenAPI wie alle anderen (E6 Teil 2). Lücken über Pfade (CVE-2025-71399) oder die eingebaute Bremse (CVE-2026-45364) treffen uns damit nicht.
3. **Nur das Nötigste eingeschaltet:** E-Mail und Passwort, keine Selbst-Registrierung, keine Plugins, kein Sitzungs-Cache im Cookie (CVE-2026-67337), keine Kontoverknüpfung, keine Telemetrie.
4. **Version fest eingetragen**, ohne `^`. Wegen der 7-Tage-Regel für neue Pakete ist das die neueste Version, die mindestens 7 Tage alt ist (06.11.2026: 1.7.14 vom 26.10.2026). Alle bekannten Meldungen sind darin behoben.

## Alternativen

- Token im Klartext lassen: einfach, aber ein Datenleck wird sofort zur Kontoübernahme.
- Eigene Sitzungsverwaltung ohne Better Auth: volle Kontrolle, aber mehr eigener Sicherheitscode, genau das sollte Better Auth uns abnehmen.
- Sitzungen nur in einem Zwischenspeicher wie Redis: ein zusätzlicher Dienst, und das Problem bleibt dort dasselbe.

## Folgen

- Die Hülle hängt an inneren Aufrufen von Better Auth (Feldname `token`). Ein Update kann sie brechen. Die Tests in `identity.db.test.ts` schlagen dann sofort an (Gegenprobe am 06.11.2026: ohne Hülle scheitern 11 von 16 Tests).
- Die Sitzungsliste „aktive Sitzungen“ (PLA-04) kann das Token nicht anzeigen und nutzt die Sitzungs-ID. Das ist ohnehin besser.
- Better Auth kennt nur ein gleitendes Ablaufdatum. Die Höchstdauer von 7 Tagen prüft die eigene Schnittstelle.
