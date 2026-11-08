# ADR-012: API-Token im Namen eines Kontos, nur mit Sitzung und frischem Passwort anlegbar

Status: angenommen. Datum: 08.11.2026. Bezug: Sicherheit 5.2 und 5.3, Architektur 4.4, SIC-03, API-01, Datenmodell 3.3, ADR-008, Etappe E6 Teil 5.

## Kontext

Skripte, später die KI (Welle 2) und Apps (Welle 4) brauchen Zugang zur Admin-API ohne Browser-Sitzung. Das Sicherheitskonzept verlangt: Präfix `shp_at_`, 32 Byte Zufall, nur der Hash gespeichert, an genau einen Shop und eine Liste von Berechtigungen gebunden, optional Ablaufdatum, jederzeit widerrufbar, letzte Nutzung sichtbar, Token nur einmal sichtbar, Schnittmenge aus Rolle und Token, erneute Passworteingabe nach 15 Minuten. Das API-Key-Plugin von Better Auth bleibt wegen CVE-2025-61928 aus (Anforderungen 6.5).

## Entscheidung

1. **Eigene Umsetzung im Modul identity** (`src/internal/api-tokens.ts`), Tabelle `identity.api_token` als Mandantentabelle unter `shop_app`. Vor der Shop-Auswahl setzt `withApiTokenTransaction` nur `app.api_token_hash`; die RLS-Regel zeigt dann genau die eine Zeile mit diesem Hash.
2. **Jedes Token gilt im Namen des Kontos, das es angelegt hat** (`issued_for_user_id`). Bei jeder Anfrage gilt: Berechtigungen des Tokens ∩ Berechtigungen der aktuellen Rolle des Kontos im Shop, ohne `api_tokens:*`. Verliert das Konto die Mitgliedschaft, wird es gesperrt oder der Shop gesperrt, gilt das Token sofort nicht mehr (401). Ein Token ohne Konto gilt nicht.
3. **Verwalten nur durch die Inhaberin** (`api_tokens:read`, `api_tokens:write` in `OWNER_ONLY_SCOPES`). **Kein Token kann Token sehen oder anlegen**: Ein gestohlenes Token kann sich so weder vervielfältigen noch den Widerruf aushebeln.
4. **Anlegen nur mit Sitzung und frischem Passwort:** Die letzte Passworteingabe (Anmeldung oder neu `POST /auth/v1/confirm-password`) darf höchstens 15 Minuten zurückliegen, sonst 403 `reauthentication_required`. Die Bestätigung ist gebremst und kann sperren wie die Anmeldung. Die Zeit steht in `identity.session.reauthenticated_at` und als `passwordConfirmedAt` in „Wer bin ich“.
5. **Ohne Idempotency-Key:** Der Speicher für Wiederholungen würde die Antwort samt Token im Klartext aufbewahren.
6. **Nach dem Anlegen unveränderlich:** `shop_app` darf an `identity.api_token` nur noch `last_used_at` und `revoked_at` ändern (Spaltenrechte) und nichts löschen. Widerrufene Token bleiben sichtbar.
7. **Weitere Grenzen:** höchstens 25 gültige Token je Shop (weiche Grenze), Ablaufdatum optional und mindestens eine Minute in der Zukunft, „zuletzt benutzt“ auf eine Minute genau. Anlegen und Widerrufen schreiben `identity.api_token.created.v1` und `identity.api_token.revoked.v1` (nur Präfix, nie Token oder Hash) und landen im Änderungsprotokoll.
8. **Aufruf:** `Authorization: Bearer shp_at_…`. Ist diese Kopfzeile da, zählt nur sie, ein Cookie daneben wird nicht beachtet. Eine abweichende `Shop-Id` ergibt 403 statt still den Shop zu wechseln.

## Alternativen

- **Token unabhängig vom Konto (nur Shop):** einfacher, aber ein Token überlebt dann den Weggang der Person, die es angelegt hat. Shopify und GitHub binden Token ebenfalls an eine Person oder App.
- **Neu anmelden statt Passwort bestätigen:** ginge ohne neuen Endpunkt, beendet aber die laufende Sitzung und verlangt bei Zwei-Faktor zusätzlich den Code.
- **Token dürfen Token verwalten:** bequemer für Automatisierung, aber ein Leck wäre nicht mehr sicher einzudämmen.

## Folgen

- Das Backoffice (E18) zeigt bei 403 `reauthentication_required` eine Passwortabfrage und wiederholt die Aktion.
- Für KI-Token (Welle 2) ist der Weg vorbereitet: Sie gelten ebenfalls im Namen eines Kontos und haben höchstens dessen Rechte.
- Die Anfragebremse zählt je Token (Akteur `api_token:<id>`).
