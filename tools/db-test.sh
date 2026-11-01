#!/usr/bin/env bash
# =============================================================================
# Startet eine Wegwerf-Datenbank (PostgreSQL 18.6, tools/lib/pg-container.sh), richtet
# sie mit dem echten Dienst migrate ein (alle Migrationen aller Module) und führt darin
# den Isolations- und Rechtetest aus (T-01 bis T-05, db/test_isolation.sh).
# Die Liste der Tabellen ohne Mandant kommt aus db/global-tables.yaml.
# Läuft lokal und in der CI gleich. Wird später ein Testcontainers-Test.
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=tools/lib/pg-container.sh
source "$ROOT/tools/lib/pg-container.sh"
DB="shop_isolation_test"

pg_start "shop-dbtest-$$" -v "$ROOT/db:/db:ro"
echo "== Migrationen mit dem Dienst migrate"
pg_migrate "$DB" "$ROOT"
echo "OK   Migrationen ausgeführt"

GLOBAL_SCHEMAS="$(node "$ROOT/tools/global-tables.mjs" schemas)"
GLOBAL_TABLES="$(node "$ROOT/tools/global-tables.mjs" tables)"
OUT="$(mktemp)"
if docker exec -e PGPORT=5432 -e TEST_DB="$DB" -e GLOBAL_SCHEMAS="$GLOBAL_SCHEMAS" -e GLOBAL_TABLES="$GLOBAL_TABLES" \
  "$PG_NAME" bash /db/test_isolation.sh >"$OUT" 2>&1; then
  grep -E "^(==|OK|FEHL)" "$OUT"
  if grep -q "FEHLGESCHLAGEN\|FEHL " "$OUT"; then echo "Datenbanktest: Fehler gefunden"; exit 1; fi
  echo "Datenbanktest bestanden."
else
  cat "$OUT"; echo "Datenbanktest fehlgeschlagen."; exit 1
fi
