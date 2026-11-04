# Testserver auf Oracle Cloud

## Stand (03.11.2026)

| Was | Wert |
|---|---|
| Server | `shop-testserver`, Oracle Cloud Frankfurt, AD-1 (AD-3 war voll), angelegt 03.11.2026 |
| Größe | `VM.Standard.A1.Flex`, 2 OCPU, 12 GB, Ubuntu 24.04 (aarch64), Benutzer `ubuntu` |
| Öffentliche IP | `130.61.18.46` (ephemeral, nachträglich an der VNIC zugewiesen, weil beim Anlegen keine vergeben wurde) |
| Adresse | `https://130-61-18-46.sslip.io` (sslip.io löst die IP auf; eigene Domain später über Variable `TESTSERVER_DOMAIN`) |
| Seitenschutz | Basic Auth, Benutzer `team`, Passwort im Secret `TESTSERVER_PASSWORD` |
| Oracle-Firewall | Default Security List: Ingress 22, 80, 443 (TCP, 0.0.0.0/0) |
| Kostenwarnung | Budget `Kostenwarnung_1_Euro`, Mail bei 1 € tatsächlichen Kosten |
| GitHub | Secrets `TESTSERVER_SSH_KEY`, `TESTSERVER_PASSWORD`, Variable `TESTSERVER_HOST` |
| Einrichtung | `.github/workflows/testserver.yml` mit `infra/testserver/` (setup.sh, compose.yaml, Caddyfile) |
| Inhalt | seit 04.11.2026 die Vorschau der Storefront (`apps/storefront`, fertige Seiten mit Beispieldaten), bei jeder Änderung an Storefront oder Kernel neu gebaut und ausgeliefert |

Was der Ablauf macht: Pakete aktualisieren, automatische Sicherheitsupdates inkl. Docker mit nächtlichem Neustart bei Bedarf (04:30), SSH nur mit Schlüssel, iptables zusätzlich 80/443 (Oracle-Regeln bleiben, kein ufw), Docker aus der offiziellen Quelle, Caddy gehärtet wie lokal mit echtem Zertifikat, HSTS und `noindex`. Danach Rauchtest: ohne Passwort 401, mit Passwort 200, HTTP leitet auf HTTPS um, SSH ohne Passwortanmeldung.

Serverschlüssel: Der erste Lauf (03.11.2026) hat den SSH-Schlüssel des Servers übernommen; er steht jetzt in `infra/testserver/known_hosts` und wird fest geprüft. Ändert er sich (Server neu angelegt), Datei leeren, einmal laufen lassen, neuen Schlüssel eintragen.

Budget: `Kostenwarnung_1_Euro` (ganzes Konto, monatlich 1 €, Warnung bei 100 % tatsächlicher Kosten per E-Mail an Kristof), angelegt 03.11.2026.

Offen: Gegenmittel gegen das Abschalten ungenutzter Gratis-Server (spätestens wenn die Anwendung läuft); API, Datenbank und Backoffice kommen mit E18.

Entscheidung Kristof 03.11.2026: öffentlicher Testserver, damit Kollegen per Link zuschauen können. Anbieter: Oracle Cloud, Gratisangebot („Always Free“). Das Konto hat Kristof selbst angelegt.

## Wer macht was

| Schritt | Wer | Wie |
|---|---|---|
| Bei Oracle anmelden (Passwort, Bestätigungscode) | Kristof | im eigenen Browser |
| Server anlegen | Claude | in einer Sitzung der Claude-App auf Kristofs Mac mit Browser-Steuerung; vor dem Klick auf „Create“ fragt Claude nach |
| Privaten Schlüssel als GitHub-Secret eintragen | Kristof (Claude zeigt den Weg) | der Schlüssel geht nie durch den Chat |
| Alles auf dem Server einrichten | Claude | per GitHub Actions |

## Einstellungen für den Server (Compute → Instances → Create instance)

- Name: `shop-testserver`
- Image: Canonical Ubuntu 24.04 (Minimal reicht nicht wegen Docker-Paketen, also das normale)
- Shape: `VM.Standard.A1.Flex` (Ampere), **2 OCPU, 12 GB** Arbeitsspeicher. Das ist genau die Grenze des Gratisangebots (1.500 OCPU-Stunden und 9.000 GB-Stunden im Monat); mehr kostet Geld.
- Boot-Volume: 100 GB (Gratis sind 200 GB gesamt)
- Netzwerk: neues virtuelles Netz mit öffentlichem Subnetz, öffentliche IPv4 zuweisen
- SSH-Schlüssel: „Generate a key pair for me“, privaten Schlüssel speichern (Datei bleibt auf Kristofs Mac)
- Meldet Oracle „Out of host capacity“: andere Availability Domain wählen oder später erneut versuchen.

## Danach

- Budget-Warnung bei 1 € (Billing → Budgets).
- GitHub → Repository → Settings → Secrets and variables → Actions: Secret `TESTSERVER_SSH_KEY` (Inhalt der Schlüsseldatei), Variable `TESTSERVER_HOST` (öffentliche IP).
- Claude: Firewall nur 80/443 (SSH nur mit Schlüssel), automatische Sicherheitsupdates, Docker, Caddy mit echtem Zertifikat, Passwortschutz für die ganze Seite, nur Testdaten, Deploy-Ablauf in GitHub Actions.
- Risiko: Oracle darf Gratis-Server abschalten, wenn 7 Tage lang CPU, Netz und Speicher unter 20 % liegen. Gegenmittel klären (regelmäßige Läufe, ggf. Upgrade auf Pay-as-you-go mit Budgetwarnung).
