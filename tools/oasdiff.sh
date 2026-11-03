#!/usr/bin/env bash
# Bruchprüfung der API (Architektur 4.3, API-03): vergleicht openapi/*.json mit dem Stand von
# BASE (Standard: origin/main, in der CI der vorige Commit bzw. das Ziel des Pull Requests).
# Bricht ab, wenn eine Änderung bestehende Nutzer brechen würde (Endpunkt entfernt, Feld entfernt,
# neues Pflichtfeld, engerer Typ ...). Neue Endpunkte und neue optionale Felder sind erlaubt.
#
# oasdiff läuft als Container-Abbild mit fester Prüfsumme (v1.34.1, Sicherheit 5.11).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${OASDIFF_IMAGE:-tufin/oasdiff@sha256:67a23cfea7d251e2ae34ee703ac8733c5d96bc2e7b90fd0f4d475ec99367b85f}"
BASE="${OASDIFF_BASE:-origin/main}"
cd "$ROOT"

if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
  echo "oasdiff: Vergleichsstand $BASE nicht gefunden, nichts zu prüfen."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0
for file in openapi/*.json; do
  api="$(basename "$file" .json)"
  if ! git cat-file -e "$BASE:$file" 2>/dev/null; then
    echo "oasdiff: $file ist neu, nichts zu vergleichen."
    continue
  fi
  git show "$BASE:$file" >"$WORK/$api.base.json"
  cp "$file" "$WORK/$api.new.json"
  echo "== oasdiff $api ($BASE → Arbeitsstand)"
  if ! docker run --rm --network none -v "$WORK:/specs:ro" "$IMAGE" \
    breaking "/specs/$api.base.json" "/specs/$api.new.json" --fail-on ERR; then
    status=1
  fi
done
if [ "$status" -ne 0 ]; then
  echo "✖ Die API würde bestehende Nutzer brechen. Neue Hauptversion oder abwärtskompatible Änderung nötig (Architektur 4.3)."
fi
exit "$status"
