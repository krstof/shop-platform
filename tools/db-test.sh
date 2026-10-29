#!/usr/bin/env bash
# =============================================================================
# Startet eine Wegwerf-Datenbank (PostgreSQL 18.6) in einem Container und führt
# darin den Isolations- und Rechtetest aus (T-01 bis T-05, db/test_isolation.sh).
# Läuft lokal und in der CI gleich. In Etappe E3 wird daraus ein Testcontainers-Test.
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4"
NAME="shop-dbtest-$$"
PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PW" \
  -v "$ROOT/db:/db:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
# Kurz warten, bis der Initialisierungs-Neustart des Abbilds durch ist.
sleep 2
until docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done

OUT="$(mktemp)"
if docker exec -e PGPORT=5432 "$NAME" bash /db/test_isolation.sh >"$OUT" 2>&1; then
  grep -E "^(==|OK|FEHL)" "$OUT" | tail -n 25
  if grep -q "FEHLGESCHLAGEN\|FEHL " "$OUT"; then echo "Datenbanktest: Fehler gefunden"; exit 1; fi
  echo "Datenbanktest bestanden."
else
  cat "$OUT"; echo "Datenbanktest fehlgeschlagen."; exit 1
fi
