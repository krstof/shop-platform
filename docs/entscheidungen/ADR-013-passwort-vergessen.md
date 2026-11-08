# ADR-013: „Passwort vergessen“ ohne Better Auth, Antwort sofort, Versand im Hintergrund

Status: angenommen. Datum: 08.11.2026. Bezug: Sicherheit 5.2, PLA-04, Datenmodell 3.3 (`identity.verification`), ADR-008, ADR-010, ADR-011, Etappe E6 Teil 6.

## Kontext

Händler und Betreiber brauchen einen Weg zurück ins Konto, wenn das Passwort vergessen ist. Das Sicherheitskonzept verlangt: Einmalcode mit 32 Byte Zufall, nur der Hash in der Datenbank, einmal verwendbar, 30 Minuten gültig; die Antwort verrät nicht, ob es die E-Mail-Adresse gibt; Bremse je Netz und je E-Mail. Better Auth bringt `requestPasswordReset` und `resetPassword` mit, speichert den Code aber im Klartext als Kennung in seiner Tabelle `verification` und meldet nach dem Zurücksetzen nicht zuverlässig alle Wege ab, auf denen unser zweiter Faktor (ADR-011) hängt. Ein Modul `notifications` für E-Mails gibt es erst mit E16.

## Entscheidung

1. **Eigene Umsetzung im Modul identity** (`src/internal/password-reset.ts`, Ablauf in `identity-service.ts`) über den Pool `shop_auth`. In `identity.verification` stehen nur der SHA-256-Wert (eindeutig, genau 32 Byte, per Prüfregel erzwungen), Zweck `password_reset`, die Konto-ID und der Ablauf. Je Konto gibt es höchstens einen gültigen Code; ein neuer ersetzt den alten.
2. **Gleiche Antwort, sofort:** `POST /auth/v1/password/forgot` antwortet immer `200 {"accepted": true}`. Nachsehen, Code anlegen und E-Mail versenden laufen danach im Hintergrund. So unterscheiden sich bekannte und unbekannte Adressen weder im Inhalt noch in der Dauer der Antwort. Unbekannte, gesperrte und deaktivierte Konten bekommen nichts.
3. **Bremsen:** die Anfragebremse der Auth-API (5 je Minute und Netz) und zusätzlich höchstens 3 E-Mails je Konto in 15 Minuten. Darüber hinaus wird still nichts verschickt (kein 429, das wäre je Konto messbar).
4. **Link mit `#`:** `https://admin.<Domain>/passwort-neu#code=…`. Der Teil nach `#` geht nie an einen Server und landet so weder in Protokollen noch in der Kopfzeile Referer.
5. **Neues Passwort:** `POST /auth/v1/password/reset` prüft zuerst die Passwortregeln (ein zu schwaches Passwort kostet den Code nicht), dann verbraucht es den Code durch Löschen in derselben Transaktion, die das Passwort setzt (von zwei gleichzeitigen Anfragen gewinnt genau eine). Danach: alle Sitzungen des Kontos beendet, E-Mail als bestätigt markiert, Sperre nach Fehlversuchen aufgehoben. **Es wird nicht angemeldet**; wer Zwei-Faktor hat, braucht beim nächsten Anmelden wieder den Code.
6. **E-Mail-Versand vorerst direkt:** Das Modul bekommt einen `MailSender` (Schnittstelle), `apps/api` setzt ihn mit Nodemailer 10.3.1 zusammen (`src/mail.ts`, nur Text, kein Nachladen von Dateien oder Adressen). `SHOP_SMTP_URL` ist Pflicht; unverschlüsselt (`smtp://`) nur zu Mailpit oder localhost. Fehler beim Versand landen ohne Empfänger und ohne Fehlertext im Protokoll.

## Alternativen

- **Better Auth `requestPasswordReset`:** weniger Code, aber Code im Klartext in der Datenbank und ein zweiter Weg, auf dem Better Auth Sitzungen und Konten anfasst.
- **Nach dem Zurücksetzen gleich anmelden:** bequemer, aber dann müsste derselbe Weg auch den zweiten Faktor verlangen; so bleibt es bei genau einer Anmeldung.
- **Warten auf E16 (notifications):** sauberer Versand mit Wiederholung, aber E6 bliebe so lange unvollständig. Der `MailSender` lässt sich später ohne Änderung im Modul gegen einen Auftrag im Worker tauschen.

## Folgen

- Mit E16 wandert der Versand in einen Hintergrund-Auftrag (Wiederholung bei Fehlern, Vorlagen). Bis dahin geht eine E-Mail bei einem Fehler verloren; der Händler fordert dann einfach erneut an.
- Die Zählung der E-Mails liegt im Arbeitsspeicher (wie die Anmelde-Bremse); ab mehreren Instanzen Valkey.
- Die Backoffice-Seite `/passwort-neu` kommt mit E18.
