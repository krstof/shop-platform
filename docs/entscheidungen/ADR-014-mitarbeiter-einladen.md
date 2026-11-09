# ADR-014: Mitarbeiter einladen und entfernen

Status: angenommen. Datum: 09.11.2026. Bezug: SIC-03, Sicherheit 5.3, Datenmodell 3.3 (`identity.membership`, `identity.verification`), ADR-008, ADR-012, ADR-013, Etappe E6 Teil 7.

## Kontext

Die Inhaberin eines Shops soll Mitarbeiter einladen und wieder entfernen können (Sicherheit 5.3: „Mitarbeiter verwalten“ nur die Inhaberin). Die eingeladene Person hat oft noch kein Konto. Konten, Passwörter und Einmalcodes darf nur die Rolle `shop_auth` anfassen (ADR-008), Mitgliedschaften sind eine Mandantentabelle der Rolle `shop_app`. Better Auth hat ein Plugin für Organisationen und Einladungen; es bringt aber eigene Tabellen und Rollen mit und speichert Einladungen nicht als Hash.

## Entscheidung

1. **Eigene Umsetzung im Modul identity**, aufgeteilt nach Rolle: `createMemberService` (shop_app: Mitgliedschaften, Ereignisse, Widerruf von Token) benutzt fünf schmale Funktionen des `IdentityService` (shop_auth: Konto ohne Passwort anlegen, Code ausstellen, lesen, einlösen, zurückziehen).
2. **Einladen** (`POST /admin/v1/members`, Berechtigung `members:write`): nur mit Sitzung (kein API-Token) und Passworteingabe vor höchstens 15 Minuten, wie beim Anlegen von API-Token. Gibt es zur Adresse kein Konto, entsteht eins **ohne Passwort** (keine Zeile in `identity.account`); anmelden kann es sich erst nach der Annahme. Die Mitgliedschaft steht auf `invited` und zählt nirgends. Heute nur Rolle `staff`.
3. **Code** wie bei „Passwort vergessen“: 32 Byte Zufall, nur SHA-256 in `identity.verification`, Zweck `invitation`, `identifier` = `<Shop-ID>:<Konto-ID>` (Prüfregel), **7 Tage**, einmal gültig, erneutes Einladen ersetzt den alten Code. Link `https://admin.<Domain>/einladung#code=…`.
4. **Annehmen** (`POST /auth/v1/invitations/accept`, öffentlich): Zuerst wird geprüft, ob die Mitgliedschaft noch `invited` ist; bei neuen Konten sind die Passwortregeln Pflicht (ein zu schwaches Passwort oder ein fehlendes kostet den Code nicht). Dann wird der Code durch Löschen verbraucht, ein fehlendes Passwort gesetzt (ein vorhandenes **nie** überschrieben) und die E-Mail als bestätigt markiert; danach wird die Mitgliedschaft `active`. Es wird nicht angemeldet.
5. **Entfernen** (`DELETE /admin/v1/members/{memberId}`): löscht die Mitgliedschaft (die Geschichte steht im Änderungsprotokoll), widerruft in derselben Transaktion alle API-Token, die im Namen dieses Kontos im Shop gelten, und löscht einen offenen Einladungscode. Wirkt bei der nächsten Anfrage, weil die Mitgliedschaft bei jeder Anfrage geprüft wird. Das Konto selbst bleibt (es kann zu anderen Shops gehören). Die Inhaberin kann nicht entfernt werden (409).
6. **API-Token können `members:*` nie tragen** (`TOKEN_FORBIDDEN_SCOPES`): Sonst könnte ein gestohlenes Token ein eigenes Konto in den Shop holen, das den Widerruf des Tokens überlebt.
7. **Grenzen:** höchstens 20 offene Einladungen je Shop, höchstens 3 Einladungs-E-Mails je Person und Shop in 15 Minuten (danach `invitationSent: false`).
8. **Ereignisse** `identity.member.invited.v1`, `.joined.v1`, `.removed.v1` nur mit IDs und Rolle, ohne E-Mail-Adresse (das Änderungsprotokoll wird nie gelöscht).

## Alternativen

- **Better-Auth-Plugin `organization`:** weniger eigener Code, aber zweites Rollenmodell neben `roles.ts`, eigene Tabellen außerhalb der RLS und Einladungen im Klartext.
- **Einladung ohne Konto bis zur Annahme** (nur E-Mail-Adresse an der Einladung): spart leere Konten, braucht aber eine zweite Tabelle mit E-Mail-Adressen pro Shop und einen Sonderweg beim Anmelden.
- **Mitgliedschaft beim Entfernen nur deaktivieren:** hielte die Zeile, aber ohne Nutzen, denn die Geschichte steht im Änderungsprotokoll; eine neue Einladung funktioniert in beiden Fällen.

## Folgen

- Leere Konten eingeladener Personen, die nie annehmen, bleiben bestehen. Aufräumen (etwa nach 30 Tagen ohne Passwort und ohne Mitgliedschaft) kommt mit dem Recht auf Löschung (E13) oder einem Aufräum-Auftrag im Worker.
- Zwischen „Code verbrauchen“ und „Mitgliedschaft aktiv“ liegen zwei Transaktionen auf zwei Rollen. Wird die Einladung genau dazwischen zurückgezogen, ist der Code verbraucht und nichts passiert; die Inhaberin lädt dann neu ein.
- Die E-Mail geht wie bei „Passwort vergessen“ direkt an Mailpit; mit E16 wandert sie in einen Auftrag mit Wiederholung.
- Backoffice-Seite `/einladung` und die Mitarbeiterliste kommen mit E18.
