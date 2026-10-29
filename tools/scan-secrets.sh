#!/usr/bin/env bash
# Sucht Geheimnisse im ganzen Git-Verlauf und in noch nicht eingecheckten Dateien (T-06).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GITLEAKS="$("$ROOT/tools/ensure-tool.sh" gitleaks)"
cd "$ROOT"
echo "== gitleaks: Git-Verlauf"
"$GITLEAKS" git --config .gitleaks.toml --redact --no-banner --exit-code 1 .
echo "== gitleaks: Arbeitsverzeichnis (ohne .env und node_modules)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# Nur Dateien, die Git kennt oder kennen würde (ignorierte wie .env bleiben außen vor).
git ls-files -co --exclude-standard -z | xargs -0 -I{} cp --parents {} "$TMP" 2>/dev/null || true
"$GITLEAKS" dir --config .gitleaks.toml --redact --no-banner --exit-code 1 "$TMP"
echo "== Keine Geheimnisse gefunden"
