#!/usr/bin/env bash
# Prüft alle Abhängigkeiten auf bekannte Sicherheitslücken (T-07, SIC-08).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OSV="$("$ROOT/tools/ensure-tool.sh" osv-scanner)"
cd "$ROOT"
echo "== OSV-Scanner"
"$OSV" scan source --lockfile pnpm-lock.yaml
echo "== pnpm audit (ab Schweregrad hoch)"
pnpm audit --audit-level high
