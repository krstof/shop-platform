# Slopify Uhr (Wear OS, pausiert seit 15.11.2026)

App für die Galaxy Watch (Wear OS 3+, minSdk 30), die neue Bestellungen zeigt und meldet.
Kristof hat sich für eine echte Uhr-App entschieden („Uhr-App“), die Arbeit ist pausiert.

## Stand

- **API fertig und getestet** (Modul identity, `src/http/devices.ts`):
  - `POST /admin/v1/device-pairings` (angemeldete Person, Scope orders:read): Kopplungscode, 8 Ziffern, 10 Minuten, einmal.
  - `POST /auth/v1/device-pairings/claim` `{code}`: liefert API-Token nur mit `orders:read`, `shopId`, `shopName`.
    Ältere Uhr-Token desselben Kontos werden widerrufen; 10 Fehlversuche je Netz in 10 Minuten, dann 429.
  - Test: `apps/api/src/api-tokens.db.test.ts` („Uhr verbinden“).
- **App-Code fertig, ließ sich bauen** (`assembleRelease` lief einmal durch, ~17 MB):
  Kopplung mit Zifferntastatur, Liste der neuesten Bestellungen, Hintergrundprüfung alle 15 Minuten
  (WorkManager) mit Mitteilung „Neue Bestellung …“ (vibriert), „Aktualisieren“, „Verbindung trennen“.
  Einheitstests in `app/src/test` (noch nicht gelaufen: Maven Central bremste die Sandbox mit 429).

## Offen (nächste Schritte)

1. Backoffice: Seite „Einstellungen → Uhr“ mit Knopf „Code erzeugen“ (großer Code, Countdown) und Anleitung.
2. GitHub-Workflow, der die APK baut (Android SDK ist auf den Runnern vorhanden) und als Release
   „uhr-latest“ veröffentlicht; Unit-Tests dort laufen lassen.
3. Fester Test-Signierschlüssel (als GitHub-Secret, nicht im Repository), damit Updates sich installieren lassen.
4. Anleitung für Kristof ohne Befehle: Entwickleroptionen auf der Uhr (Info → Software → Softwareversion
   5× tippen), ADB-Debugging und Debugging über WLAN an; APK mit einer Handy-App wie „Wear Installer 2“
   aufs Handy laden und über WLAN auf die Uhr spielen.
5. Am echten Gerät prüfen (rund, 1,2–1,4 Zoll).

## Bauen (lokal)

```
export ANDROID_HOME=…/android-sdk   # platforms;android-35, build-tools;35.0.0
gradle assembleRelease testReleaseUnitTest      # Gradle 8.14, JDK 17+
gradle assembleRelease -PapiBase=https://api.example   # andere API-Adresse
```
