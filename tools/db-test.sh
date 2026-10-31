#!/usr/bin/env bash
# =============================================================================
# Startet eine Wegwerf-Datenbank (PostgreSQL 18.6) in einem Container, richtet sie
# mit dem echten Dienst migrate ein (alle Migrationen aller Module) und führt darin
# den Isolations- und Rechtetest aus (T-01 bis T-05, db/test_isolation.sh).
# Die Datenbank lauscht nur auf 127.0.0.1 an einem zufälligen Port.
# Läuft lokal und in der CI gleich. In Teil 2 von E3 wird daraus ein Testcontainers-Test.
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4"
NAME="shop-dbtest-$$"
DB="shop_isolation_test"
PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# Der Dienst migrate muss gebaut sein.
if [ ! -f "$ROOT/apps/migrate/dist/main.js" ] || [ ! -f "$ROOT/packages/kernel/dist/db/migrate.js" ]; then
  (cd "$ROOT" && pnpm -s --filter "@shop/migrate..." -r run build)
fi

docker run -d --name "$NAME" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$PW" \
  -v "$ROOT/db:/db:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
# Kurz warten, bis der Initialisierungs-Neustart des Abbilds durch ist.
sleep 2
until docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done

PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
docker exec "$NAME" psql -U postgres -X -q -c "CREATE DATABASE $DB"

echo "== Migrationen mit dem Dienst migrate"
SHOP_ENV=test SHOP_LOG_LEVEL=warn \
  SHOP_MIGRATE_DATABASE_URL="postgres://postgres:${PW}@127.0.0.1:${PORT}/${DB}" \
  node "$ROOT/apps/migrate/dist/main.js"
echo "OK   Migrationen ausgeführt"

OUT="$(mktemp)"
if docker exec -e PGPORT=5432 -e TEST_DB="$DB" "$NAME" bash /db/test_isolation.sh >"$OUT" 2>&1; then
  grep -E "^(==|OK|FEHL)" "$OUT" | tail -n 25
  if grep -q "FEHLGESCHLAGEN\|FEHL " "$OUT"; then echo "Datenbanktest: Fehler gefunden"; exit 1; fi
  echo "Datenbanktest bestanden."
else
  cat "$OUT"; echo "Datenbanktest fehlgeschlagen."; exit 1
fi
