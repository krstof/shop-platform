#!/usr/bin/env bash
# =============================================================================
# Führt die Tests aller Pakete mit einer Wegwerf-Datenbank aus (PostgreSQL 18.6).
# Die Datenbank lauscht nur auf 127.0.0.1 an einem zufälligen Port und wird am
# Ende wieder gelöscht. SHOP_REQUIRE_DB_TESTS=true sorgt dafür, dass Datenbanktests
# nicht still übersprungen werden. Läuft lokal und in der CI gleich.
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4"
NAME="shop-pkgtest-$$"
PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$PW" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
# Kurz warten, bis der Initialisierungs-Neustart des Abbilds durch ist.
sleep 2
until docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done

PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
export SHOP_TEST_DATABASE_URL="postgres://postgres:${PW}@127.0.0.1:${PORT}/postgres"
export SHOP_REQUIRE_DB_TESTS=true
cd "$ROOT"
pnpm -s test
