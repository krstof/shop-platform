#!/usr/bin/env bash
# =============================================================================
# Datenbanktypen je Modul (Architektur 3.4): migriert eine Wegwerf-Datenbank mit dem
# echten Dienst migrate und erzeugt mit kysely-codegen für jedes Modul (und den Kernel)
# die Datei src/db.generated.ts, die NUR die Tabellen des eigenen Schemas enthält.
# Eine Abfrage auf eine fremde Tabelle lässt sich damit gar nicht erst übersetzen.
#
#   pnpm db:types          Dateien neu erzeugen (nach jeder neuen Migration)
#   pnpm db:types --check  nur prüfen, ob die eingecheckten Dateien aktuell sind (CI)
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=tools/lib/pg-container.sh
source "$ROOT/tools/lib/pg-container.sh"
MODE="${1:-write}"

pg_start "shop-dbtypes-$$"
pg_migrate shop_codegen "$ROOT"

# Die Adresse geht über eine Umgebungsvariable an kysely-codegen, nicht über die Befehlszeile.
export SHOP_CODEGEN_URL="postgres://postgres:${PG_PW}@127.0.0.1:${PG_PORT}/shop_codegen"
node "$ROOT/tools/db-types.mjs" "$MODE"
