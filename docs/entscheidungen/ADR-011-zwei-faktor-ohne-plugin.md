# ADR-011: Zwei-Faktor (TOTP) im eigenen Modul statt mit dem Better-Auth-Plugin

Status: angenommen. Datum: 07.11.2026. Bezug: Sicherheit 5.2 und 5.10, SIC-03, SIC-06, ADR-008, ADR-010, Etappe E6 Teil 4.

## Kontext

Das Betreiberkonto braucht schon in Welle 1 einen zweiten Faktor: einen Code aus einer Authenticator-App (TOTP) und Ersatzcodes. Better Auth bringt dafür ein Plugin mit. Vor dem Einbau wurden die Sicherheitsmeldungen und die Dokumentation geprüft (07.11.2026):

- **GHSA-xg6x-h9c9-2m83** (kritisch, bis 1.4.8): Mit Sitzungs-Cache im Cookie ließ sich der zweite Faktor überspringen. Bei uns ist der Cache aus (ADR-010).
- **GHSA-9p5w-h4pr-fcrc** (hoch, Sicherheitsausgabe 1.7.16 vom 03.11.2026): Das Electron-Plugin konnte den zweiten Faktor umgehen. Wir nutzen es nicht.
- Das Plugin verschlüsselt das TOTP-Geheimnis mit dem allgemeinen Geheimnis von Better Auth (`SHOP_AUTH_SECRET`), nicht mit einem eigenen Hauptschlüssel und ohne Schlüsselversion. Ein eigenes Verfahren lässt sich laut Dokumentation nicht einhängen. Sicherheit 5.10 verlangt aber Envelope Encryption mit Hauptschlüssel und Version.
- Ob das Plugin einen Code innerhalb seines Zeitfensters ein zweites Mal annimmt, ist nicht dokumentiert.
- Das Plugin bringt eigene HTTP-Wege, ein eigenes Zwischen-Cookie und „vertrauenswürdige Geräte“ (30 Tage ohne Code) mit. Wir geben Better Auth aber keinen HTTP-Zugang (ADR-010).

## Entscheidung

1. **TOTP selbst, klein und geprüft** (`modules/identity/src/internal/totp.ts`, etwa 120 Zeilen): RFC 6238 mit HMAC-SHA1, 6 Ziffern, 30 Sekunden, ein Zeitschritt Spielraum. Getestet mit den Prüfwerten aus RFC 6238 Anhang B. Jeder Code gilt nur einmal: Der zuletzt benutzte Zeitschritt steht in `identity.two_factor.last_used_step`, die Zeile wird beim Prüfen gesperrt (`FOR UPDATE`), damit zwei gleichzeitige Anfragen mit demselben Code nicht beide gelten.
2. **Geheimnis und Ersatzcodes mit dem Hauptschlüssel verschlüsselt** (`packages/kernel/src/secret-box.ts`): AES-256-GCM mit eigenem Schlüssel je Wert, der mit dem Hauptschlüssel `SHOP_MASTER_KEY_V1` verschlüsselt wird. Jeder Wert trägt die Schlüsselversion und ist an seinen Zweck und sein Konto gebunden (`identity.two_factor.secret:<user-id>`). Ein in eine fremde Zeile kopierter Wert lässt sich nicht öffnen. Dasselbe Werkzeug nutzen später die Schlüssel der Zahlungsanbieter.
3. **Zweistufige Anmeldung über die Sitzung selbst:** Nach richtigem Passwort legt Better Auth wie bisher die Sitzung an. Hat das Konto Zwei-Faktor, ist sie „wartend“ (`identity.session.two_factor_verified_at` leer) und gilt nirgends, auch nicht für „Wer bin ich“. Erst `POST /auth/v1/two-factor/verify` mit richtigem Code bestätigt sie. Nach 5 falschen Codes oder nach 10 Minuten wird die wartende Sitzung gelöscht; die Anmeldung beginnt dann mit dem Passwort neu (das wiederum gebremst ist).
4. **Einrichten nur mit erneuter Passworteingabe**, in zwei Schritten (`setup`, dann `enable` mit einem ersten Code innerhalb von 15 Minuten). Danach werden alle anderen Sitzungen des Kontos beendet. Eine eingeschaltete Zwei-Faktor-Anmeldung lässt sich über die API weder ersetzen noch ausschalten.
5. **Platform-API nur mit bestätigtem zweitem Faktor:** `apps/api` gibt die Berechtigungen `platform:*` nur, wenn die Sitzung bestätigt ist und das Konto in `platform.platform_user` aktiv ist (ohne Shop-Id). Für jedes Betreiberkonto gelten strengere Sitzungsregeln: 1 Stunde ohne Aktivität, höchstens 12 Stunden.

## Alternativen

- **Better-Auth-Plugin:** weniger eigener Code, aber ohne Envelope Encryption, mit unklarem Schutz gegen Wiederverwenden und mit Funktionen, die wir abschalten müssten. Die meisten Meldungen von Better Auth betrafen gerade Plugins.
- **Bibliothek wie otplib:** spart die 40 Zeilen für RFC 6238, bringt aber eine weitere Abhängigkeit. Der Rechenweg ist kurz und mit den offiziellen Prüfwerten getestet.
- **Passkeys statt TOTP:** stärker gegen Phishing, aber aufwendiger (WebAuthn) und für Welle 2 geplant (SIC-09).

## Folgen

- Zwei-Faktor ist eigener Sicherheitscode und muss bei Änderungen genauso streng getestet werden (`totp.test.ts`, `two-factor.db.test.ts`, `apps/api/src/platform.db.test.ts`).
- Better Auth weiß nichts vom zweiten Faktor. Neue Wege, auf denen Better Auth Sitzungen anlegt (etwa „Passwort vergessen“ in E6 Teil 6), müssen den Zustand „wartend“ ebenso beachten; Sitzungen von Konten mit Zwei-Faktor sind ohne Bestätigung von selbst wartend.
- Geht das Handy samt Ersatzcodes verloren, gibt es noch keinen Weg zurück (siehe FRAGEN.md).
- Ein Wechsel des Hauptschlüssels braucht später ein kleines Umschlüssel-Programm (`SHOP_MASTER_KEY_V2` dazunehmen, Werte neu verschlüsseln, V1 entfernen).
