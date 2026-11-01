#!/usr/bin/env bash
# =============================================================================
# Führt die Tests aller Pakete mit einer Wegwerf-Datenbank aus (PostgreSQL 18.6,
# tools/lib/pg-container.sh). SHOP_REQUIRE_DB_TESTS=true sorgt dafür, dass
# Datenbanktests nicht still übersprungen werden. Läuft lokal und in der CI gleich.
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=tools/lib/pg-container.sh
source "$ROOT/tools/lib/pg-container.sh"

pg_start "shop-pkgtest-$$"
export SHOP_TEST_DATABASE_URL="postgres://postgres:${PG_PW}@127.0.0.1:${PG_PORT}/postgres"
export SHOP_REQUIRE_DB_TESTS=true
cd "$ROOT"
pnpm -s test
