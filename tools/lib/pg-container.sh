#!/usr/bin/env bash
# =============================================================================
# Gemeinsamer Baustein: startet eine Wegwerf-Datenbank (PostgreSQL 18.6) in einem
# Container, die nur auf 127.0.0.1 an einem zufälligen Port lauscht und beim Ende
# des aufrufenden Skripts gelöscht wird. Wird mit „source“ eingebunden.
#
# Nach pg_start <name> [weitere docker-run-Argumente] stehen bereit:
#   PG_NAME  Name des Containers     PG_PW    zufälliges Passwort von postgres
#   PG_PORT  Port auf 127.0.0.1
# =============================================================================
PG_IMAGE="postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4"

pg_start() {
  PG_NAME="$1"
  shift
  PG_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
  trap 'docker rm -f "$PG_NAME" >/dev/null 2>&1 || true' EXIT
  docker run -d --name "$PG_NAME" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$PG_PW" "$@" "$PG_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    if docker exec "$PG_NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
    sleep 1
  done
  # Kurz warten, bis der Initialisierungs-Neustart des Abbilds durch ist.
  sleep 2
  until docker exec "$PG_NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
  PG_PORT="$(docker port "$PG_NAME" 5432/tcp | head -n1 | sed 's/.*://')"
}

# Legt eine Datenbank an und migriert sie mit dem echten Dienst migrate.
# pg_migrate <datenbank> <repo-wurzel>
pg_migrate() {
  local db="$1" root="$2"
  if [ ! -f "$root/apps/migrate/dist/main.js" ] || [ ! -f "$root/packages/kernel/dist/db/migrate.js" ]; then
    (cd "$root" && pnpm -s --filter "@shop/migrate..." -r run build)
  fi
  docker exec "$PG_NAME" psql -U postgres -X -q -c "CREATE DATABASE $db"
  SHOP_ENV=test SHOP_LOG_LEVEL=warn \
    SHOP_MIGRATE_DATABASE_URL="postgres://postgres:${PG_PW}@127.0.0.1:${PG_PORT}/${db}" \
    node "$root/apps/migrate/dist/main.js"
}
