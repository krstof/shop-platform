# @shop/testing

Testhilfen für alle Pakete (Etappe E3 Teil 3, Architektur 8.1).

| Was | Wozu |
|---|---|
| `startTestDatabase()` | Startet PostgreSQL 18.6 (Abbild mit fester Prüfsumme) per Testcontainers mit zufälligem Passwort. `migrate(name)` legt eine Datenbank an und richtet sie mit dem echten Dienst `migrate` ein, `psql(...)` führt psql im Container aus, `stop()` löscht den Container. |
| `shop-testdb` (`tools/testdb.mjs`) | Startet eine Wegwerf-Datenbank für die Dauer eines Befehls. Grundlage von `pnpm test:with-db` und `pnpm db:types`. |
| `src/isolation.db.test.ts` | Isolations- und Rechtetest T-01 bis T-05 (`pnpm test:db`). Die Prüfungen selbst stehen in `db/test_isolation.sql` und `db/test_sicherheit.sql`. |

Sicherheit: Der Aufräum-Hilfscontainer „Ryuk“ von Testcontainers ist abgeschaltet
(`TESTCONTAINERS_RYUK_DISABLED=true`), weil er vollen Zugriff auf Docker bräuchte. Die Hilfe
löscht ihre Container selbst, auch bei Abbruch des Prozesses. Testcontainers erlaubt keine
Bindung nur an 127.0.0.1; der Port ist zufällig, das Passwort ebenfalls, und der Container lebt
nur während des Tests.

Kein Paket importiert `@shop/testing` im Programmcode; es ist nur für Tests und Werkzeuge da.
