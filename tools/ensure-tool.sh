#!/usr/bin/env bash
# =============================================================================
# Lädt ein Prüfwerkzeug in fester Version herunter und prüft die SHA-256-Prüfsumme,
# bevor es benutzt wird (Sicherheit 5.11). Gibt den Pfad zum Programm aus.
# Aufruf: tools/ensure-tool.sh gitleaks|osv-scanner
# Neue Versionen: Version UND Prüfsumme hier ändern (Prüfsumme aus der offiziellen
# Prüfsummen-Datei des Projekts, Veröffentlichung mindestens 7 Tage alt).
# =============================================================================
set -euo pipefail
TOOL="${1:?Werkzeug fehlt}"
CACHE="${SHOP_TOOLS_DIR:-$HOME/.cache/shop-platform/bin}"
mkdir -p "$CACHE"

case "$TOOL" in
  gitleaks)
    VERSION="8.30.1"
    URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz"
    SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ARCHIVE=tar ;;
  osv-scanner)
    VERSION="2.7.0"
    URL="https://github.com/google/osv-scanner/releases/download/v${VERSION}/osv-scanner_linux_amd64"
    SHA256="160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"
    ARCHIVE=none ;;
  *) echo "Unbekanntes Werkzeug: $TOOL" >&2; exit 2 ;;
esac

BIN="$CACHE/$TOOL-$VERSION"
if [[ ! -x "$BIN" ]]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -sSfL --retry 3 -o "$TMP/download" "$URL"
  echo "$SHA256  $TMP/download" | sha256sum -c --quiet - >&2 || { echo "Prüfsumme falsch für $TOOL" >&2; exit 1; }
  if [[ "$ARCHIVE" == tar ]]; then tar -xzf "$TMP/download" -C "$TMP" "$TOOL"; mv "$TMP/$TOOL" "$BIN"; else mv "$TMP/download" "$BIN"; fi
  chmod +x "$BIN"
fi
echo "$BIN"
