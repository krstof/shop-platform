# Testserver auf Oracle Cloud

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
