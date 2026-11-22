# CLAUDE.md – Shop-Plattform (Lern-Experiment)

Diese Datei steuert jede Arbeitssitzung in diesem Repository, auch die täglichen automatischen Läufe. Lies sie zuerst, danach `STATUS.md` und `FRAGEN.md`.

## 1. Worum es geht

Kristof (kein Entwickler, arbeitet bei ePages im Marketing) lässt Claude eine Shop-Plattform im Stil von ePages oder Shopify bauen. Es ist ein **rein privates Experiment**: Es wird nie echte Händler, echte Kunden oder echtes Geld geben, und außer Kristof sehen es nur Kollegen, denen er den Link zum passwortgeschützten Testserver schickt (docs/07_Testserver.md). Trotzdem wird so gebaut, als wäre es ernst, weil Qualität und Sicherheit Teil des Lernziels sind.

Drei Ebenen:
1. **Plattform-Verwaltung** (Rolle des Anbieters): Händler und Shops anlegen, sperren, Tarife.
2. **Händler-Backend** pro Shop, inklusive Shop-Editor für das Aussehen.
3. **Storefront** pro Shop (der Shop, den Endkunden sehen).

## 1a. MVP-Fokus (Kristof, 09.11.2026, gilt vor allem anderen)

Das System ist nur ein Test für Kristof und ein paar Kollegen. Es wird nie echte Händler oder Kunden haben. Daraus folgt:

- **Nur bauen, was man beim Ausprobieren merkt:** Shop ansehen, Produkt anlegen, kaufen, Bestellung im Backoffice sehen, Shops in der Plattform-Verwaltung anlegen. Grundfunktionen wie Anmelden und „Passwort vergessen“ müssen funktionieren, mehr nicht.
- **Nichts, was nur ein echter Händler bräuchte:** keine Rechtspflichten (Rechtstexte, Widerrufsbutton, Barrierefreiheitserklärung, GPSR), keine Feinheiten wie Ablaufdaten, Hinweis-E-Mails, Sonderrechte, Notwege, zusätzliche Härtung. Solche Ideen kommen ohne Rückfrage in die Liste „Später“ in `STATUS.md`.
- **Größere Schritte, schnell sichtbare Ergebnisse:** lieber eine Funktion einfach und Ende zu Ende (API und Oberfläche) als eine Schicht perfekt. Oberflächen früh, nicht erst am Schluss.
- **Fragen nur, wenn die Antwort etwas Sichtbares ändert.** Sonst einen vernünftigen Standard wählen und kurz im Bericht nennen. Keine Fragen zu Sicherheitsdetails, Protokollen, Fristen oder E-Mail-Hinweisen.
- **Tests im Verhältnis:** Was gebaut wird, wird getestet, und die bestehenden Prüfungen (CI, Mandantentrennung) bleiben grün. Aber keine langen Gegenproben-Serien oder Recherchen zu Randfällen mehr.
- **Bericht kurz:** 2–3 Sätze, was man jetzt ausprobieren kann. Keine Aufzählung technischer Details.

## 2. Grundsätze (verbindlich)

- **Sicherheit zuerst.** Mandantentrennung (kein Shop sieht Daten eines anderen), OWASP-Regeln, keine Geheimnisse im Code, Zahlung nur über gehostete Testzahlung.
- **API-first.** Jede Funktion ist zuerst eine Schnittstelle, Oberflächen nutzen dieselbe API wie spätere Partner und Apps.
- **Modular.** Modularer Monolith mit harten Modulgrenzen, jedes Modul später als eigener Dienst herauslösbar. Keine Microservices ab Tag 1.
- **Keine Sackgassen.** Datenmodell von Anfang an offen für B2B, mehrere Sprachen, Währungen, Steuerregeln, Varianten, Kundengruppen.
- **KI-first.** Ziel ist, dass der Händler fast alles im Chat erledigt, inklusive Bilder.
- **Nur kostenlose Technik** (Open Source), überall selbst hostbar, kein Anbieter-Lock-in.
- **Einfachheit für den Nutzer** und modernes Design. Bewährtes von Shopify und Co. übernehmen, aber alles neu und einfacher denken.
- **Wellen statt Big Bang.** Welle 1 ist das MVP: Produkte anlegen, in den Warenkorb legen und kaufen (Deutschland, Testzahlung).

## 3. Wellenplan

| Welle | Inhalt |
|---|---|
| 0 | Fundament: Marktanalyse, Featurekatalog, Architektur, Sicherheitskonzept, Techstack |
| 1 | MVP Deutschland: Produkte, Warenkorb, Checkout mit Testzahlung, Bestellungen, Grundverwaltung |
| 2 | KI-Chat für Händler und Shop-Editor |
| 3 | B2B |
| 4 | Partner-API, App-System, Internationalisierung |
| 5 | Erweiterungen |

## 4. Arbeitsweise

- Kein eigener Anforderungskatalog mehr je Feature. Claude baut die einfachste Version, die beim Ausprobieren funktioniert (Abschnitt 1a). Nur bei großen, sichtbaren Weichen (etwa wie der Checkout aussieht) kurz fragen.
- Für einfache Arbeiten (Recherche, Zusammenfassungen) günstigere Modelle nutzen, für Architektur und schwierigen Code das stärkste Modell.
- Kristof tippt nie Befehle und startet keine Skripte. Alles Technische erledigt Claude.
- Kurze, klare deutsche Sprache, keine Fachbegriffe ohne Erklärung. Das anklickbare Bedienelement heißt überall **Button**, nicht „Knopf“ (Kristof, 22.11.2026).

## 5. Ablauf eines täglichen Laufs

1. `STATUS.md` lesen: Was ist erledigt, was ist der nächste Schritt?
2. `FRAGEN.md` lesen: Hat Kristof offene Fragen beantwortet? Antworten einarbeiten.
3. Den nächsten Schritt aus `STATUS.md` umsetzen. Eine sinnvolle, abgeschlossene Etappe pro Lauf, nicht mehr.
4. Testen, was gebaut wurde.
5. `STATUS.md` aktualisieren (erledigt, nächster Schritt).
6. Nur wenn wirklich nötig (Abschnitt 1a): neue Fragen an Kristof in `FRAGEN.md` eintragen, nummeriert, je 1–2 Sätze Kontext, mit Ein-Wort-Antwortmöglichkeit. Keine Fragen ist der Normalfall.
7. Commit und Push auf `main`.
8. Zum Schluss eine kurze Nachricht an Kristof: was man jetzt ausprobieren kann (2–3 Sätze) und offene Fragen, falls es welche gibt.

Wenn etwas blockiert (fehlende Entscheidung, Fehler), nicht raten, sondern als Frage aufnehmen und an einer anderen offenen Stelle weiterarbeiten.

## 6. Ordnerstruktur

- `docs/` – Analysen, Featurekatalog, Architektur, Entscheidungen (`docs/entscheidungen/` als ADRs)
- `STATUS.md` – Fortschritt und nächster Schritt
- `FRAGEN.md` – offene und beantwortete Fragen an Kristof
- `docs/10_Wunschliste.md` – Kristofs Wünsche und der Fahrplan in Paketen; zusammen mit `STATUS.md` lesen, bevor ein neues Paket beginnt
- Code-Ordner entstehen ab Welle 1 laut Architektur-Dokument.
