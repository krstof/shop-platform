#!/usr/bin/env bash
# =============================================================================
# test_isolation.sh
# Legt eine frische Testdatenbank an, spielt db/schema_welle1.sql ein, erzeugt
# zwei Shops (A und B) und führt db/test_isolation.sql als Anwendungsrolle
# shop_app aus. Danach prüft es mit db/test_sicherheit.sql die Rechte aller Datenbankrollen,
# versucht als shop_app echte Zugriffe auf Anmeldedaten und prüft lückenlose Nummern
# bei gleichzeitigen Bestellungen.
#
# Voraussetzung: PostgreSQL 18 läuft lokal. Standard: Port 5433, Superuser postgres.
# Einstellbar über Umgebungsvariablen PGPORT, TEST_DB, ADMIN_PSQL.
# Wird später durch Testcontainers in der CI ersetzt (Architektur 8.1).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PGPORT="${PGPORT:-5433}"
TEST_DB="${TEST_DB:-shop_isolation_test}"
ADMIN_PSQL="${ADMIN_PSQL:-runuser -u postgres -- psql}"
A="0192f000-0000-7000-8000-00000000000a"
B="0192f000-0000-7000-8000-00000000000b"

admin() { $ADMIN_PSQL -p "$PGPORT" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "== PostgreSQL-Version"
admin -d postgres -tAc "SELECT version()"

echo "== Frische Testdatenbank $TEST_DB"
admin -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB" -c "CREATE DATABASE $TEST_DB"

echo "== Schema einspielen"
admin -d "$TEST_DB" -o /dev/null -f "$HERE/schema_welle1.sql"

# Nur für diesen Test: zufälliges Passwort für shop_app, damit wir uns echt als shop_app anmelden
APP_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
admin -d "$TEST_DB" -c "ALTER ROLE shop_app PASSWORD '$APP_PW'"

echo "== Zwei Händler und Shops anlegen (als shop_platform)"
admin -d "$TEST_DB" <<SQL
SET ROLE shop_platform;
WITH m AS (
  INSERT INTO platform.merchant (name) VALUES ('Händler A') RETURNING id
)
INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
SELECT '$A', m.id, p.id, 'teeladen-a', 'Teeladen A', 'active' FROM m, platform.plan p WHERE p.is_default;
WITH m AS (
  INSERT INTO platform.merchant (name) VALUES ('Händler B') RETURNING id
)
INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
SELECT '$B', m.id, p.id, 'teeladen-b', 'Teeladen B', 'active' FROM m, platform.plan p WHERE p.is_default;
INSERT INTO platform.tenant_domain (tenant_id, hostname, kind, is_primary) VALUES
  ('$A', 'teeladen-a.shop.localhost', 'subdomain', true),
  ('$B', 'teeladen-b.shop.localhost', 'subdomain', true);
-- Plattform-Eintrag ohne Mandant im Audit-Log: darf für Shops unsichtbar sein
INSERT INTO audit.audit_entry (tenant_id, actor_type, action, entity_type) VALUES (NULL, 'operator', 'platform.tenant.created', 'tenant');
SQL

echo "== Inhaber-Konten anlegen (als shop_auth, das Anmeldemodul)"
admin -d "$TEST_DB" <<SQL
SET ROLE shop_auth;
WITH u AS (
  INSERT INTO identity."user" (email, name) VALUES
    ('a@haendler.test', 'Inhaber a'), ('b@haendler.test', 'Inhaber b') RETURNING id, email
)
INSERT INTO identity.account (user_id, provider_id, account_id, password_hash)
SELECT id, 'credential', email, '\$argon2id\$v=19\$m=19456,t=2,p=1\$dGVzdA\$dGVzdA' FROM u;
SQL

APP_CONN="host=127.0.0.1 port=$PGPORT dbname=$TEST_DB user=shop_app"

echo "== Isolationstest als shop_app"
PGPASSWORD="$APP_PW" PGOPTIONS="-c test.a=$A -c test.b=$B" \
  psql "$APP_CONN" -X -v A="$A" -v B="$B" -f "$HERE/test_isolation.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //'

echo "== Rechte der Datenbankrollen"
admin -d "$TEST_DB" -f "$HERE/test_sicherheit.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //'

echo "== Echte Zugriffsversuche als shop_app auf Anmeldedaten"
for Q in 'SELECT password_hash FROM identity.account' 'SELECT token_hash FROM identity.session' \
         'SELECT * FROM identity."user"' "UPDATE identity.\"user\" SET status = 'active'"; do
  if ERR="$(PGPASSWORD="$APP_PW" psql "$APP_CONN" -X -q -tA -c "$Q" 2>&1)"; then
    echo "FEHLGESCHLAGEN: shop_app durfte ausführen: $Q"; exit 1
  elif echo "$ERR" | grep -q "permission denied\|keine Berechtigung"; then
    echo "OK   Verweigert: $Q"
  else
    echo "FEHLGESCHLAGEN: unerwarteter Fehler bei $Q: $ERR"; exit 1
  fi
done
N="$(PGPASSWORD="$APP_PW" psql "$APP_CONN" -X -q -tA -c 'SELECT count(*) FROM (SELECT id, name, email FROM identity."user") u')"
[ "$N" = "2" ] && echo "OK   Erlaubte Spalten (id, name, email) der Nutzer sind lesbar" || { echo "FEHLGESCHLAGEN: Nutzer nicht lesbar"; exit 1; }

echo "== Lückenlose Nummern bei 20 gleichzeitigen Transaktionen (5 davon brechen ab)"
OUT="$(mktemp)"
for i in $(seq 1 25); do
  if [ "$i" -le 20 ]; then END="COMMIT"; SHOW='\echo :nr'; else END="ROLLBACK"; SHOW=''; fi
  PGPASSWORD="$APP_PW" psql "$APP_CONN" -X -q -tA -v ON_ERROR_STOP=1 >> "$OUT" <<SQL &
BEGIN;
SELECT set_config('app.tenant_id', '$A', true) \g /dev/null
SELECT shop_settings.next_number('delivery_note') AS nr \gset
SELECT pg_sleep(random() * 0.05) \g /dev/null
$END;
$SHOW
SQL
done
wait
sort "$OUT" > "$OUT.sorted"
EXPECTED="$(for n in $(seq 1 20); do printf 'L-%04d\n' "$n"; done)"
if [ "$(cat "$OUT.sorted")" = "$EXPECTED" ]; then
  echo "OK   20 gleichzeitige Transaktionen erhielten genau L-0001 bis L-0020, ohne Lücke und ohne Doppel"
else
  echo "FEHLGESCHLAGEN: Nummern waren:"; cat "$OUT.sorted"; exit 1
fi
NEXT="$(PGPASSWORD="$APP_PW" psql "$APP_CONN" -X -q -tA -c "BEGIN" -c "SELECT set_config('app.tenant_id', '$A', true)" -c "SELECT shop_settings.next_number('delivery_note')" -c "ROLLBACK" | tail -n 1)"
if [ "$NEXT" = "L-0021" ]; then
  echo "OK   Abgebrochene Transaktionen haben keine Nummer verbraucht, die nächste ist L-0021"
else
  echo "FEHLGESCHLAGEN: nächste Nummer war $NEXT"; exit 1
fi
rm -f "$OUT" "$OUT.sorted"

echo "== Alle Tests bestanden"
