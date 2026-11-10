#!/usr/bin/env bash
# =============================================================================
# Richtet den Testserver ein (docs/07_Testserver.md). Läuft als root auf dem
# Server, aufgerufen vom GitHub-Ablauf `.github/workflows/testserver.yml`.
# Darf beliebig oft laufen: Jeder Schritt prüft erst, ob er schon erledigt ist.
#
# Erwartet im selben Ordner: source.tar.gz (Stand des Repositorys), secrets.env (für Caddy:
# TESTSERVER_DOMAIN, TESTSERVER_USER, TESTSERVER_PASSWORD_HASH) und site-password (Klartext,
# nur für Testdaten und Mailpit; liegt danach mit Rechten 600 in /opt/shop-testserver).
# =============================================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/shop-testserver
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Muss als root laufen." >&2; exit 1; }
for f in secrets.env site-password source.tar.gz; do
  [ -s "$SRC/$f" ] || { echo "Datei fehlt: $f" >&2; exit 1; }
done

# --- 1. System aktuell halten -------------------------------------------------
log "Pakete aktualisieren"
apt-get update -q
apt-get -q -y -o Dpkg::Options::=--force-confold upgrade
apt-get -q -y install ca-certificates curl gnupg unattended-upgrades iptables-persistent

log "Automatische Sicherheitsupdates (inkl. Docker, Neustart nachts bei Bedarf)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52shop-testserver <<'EOF'
Unattended-Upgrade::Origins-Pattern {
        "origin=Docker";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null

# --- 2. SSH nur mit Schlüssel -------------------------------------------------
log "SSH härten"
cat > /etc/ssh/sshd_config.d/99-shop-testserver.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
AllowAgentForwarding no
EOF
sshd -t
systemctl reload ssh

# --- 3. Firewall: nur 22, 80, 443 ---------------------------------------------
# Oracle-Abbilder bringen eigene iptables-Regeln mit (nur SSH offen, Rest
# REJECT). ufw verträgt sich damit nicht, deshalb ergänzen wir die Regeln
# direkt in der gespeicherten Datei und im laufenden System. Die Datei wird
# nie mit `netfilter-persistent save` überschrieben, sonst landen Dockers
# eigene Regeln darin.
log "Firewall: Ports 80 und 443 freigeben"
RULES=/etc/iptables/rules.v4
for port in 80 443; do
  rule="-A INPUT -p tcp -m state --state NEW -m tcp --dport $port -j ACCEPT"
  if [ -f "$RULES" ] && ! grep -qxF -- "$rule" "$RULES"; then
    # vor der ersten REJECT-Regel der INPUT-Kette einfügen
    awk -v r="$rule" '!done && /^-A INPUT .*-j REJECT/ { print r; done=1 } { print }' "$RULES" > "$RULES.new"
    mv "$RULES.new" "$RULES"
  fi
  if ! iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    pos="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT" {print $1; exit}')"
    iptables -I INPUT "${pos:-1}" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  fi
done

# --- 4. Docker aus der offiziellen Paketquelle --------------------------------
if ! command -v docker >/dev/null; then
  log "Docker installieren"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -q -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
install -d /etc/docker
cat > /etc/docker/daemon.json.new <<'EOF'
{
  "log-driver": "local",
  "live-restore": true,
  "no-new-privileges": true
}
EOF
systemctl enable docker >/dev/null
if ! cmp -s /etc/docker/daemon.json.new /etc/docker/daemon.json; then
  mv /etc/docker/daemon.json.new /etc/docker/daemon.json
  systemctl restart docker
else
  rm /etc/docker/daemon.json.new
fi

# --- 5. Anwendung: ganze Plattform wie lokal (M5) ---------------------------
log "Quellstand nach $APP_DIR/src"
install -d -m 0750 "$APP_DIR"
install -m 0600 "$SRC/secrets.env" "$APP_DIR/secrets.env"
install -m 0600 "$SRC/site-password" "$APP_DIR/site-password"
rm -rf "$APP_DIR/src.new"
install -d -m 0755 "$APP_DIR/src.new"
tar -xzf "$SRC/source.tar.gz" -C "$APP_DIR/src.new" --no-same-owner
[ -s "$APP_DIR/src.new/infra/compose.yaml" ] || { echo "infra/compose.yaml fehlt im Paket" >&2; exit 1; }
rm -rf "$APP_DIR/src"
mv "$APP_DIR/src.new" "$APP_DIR/src"

# shellcheck source=/dev/null
. "$APP_DIR/secrets.env"
DOMAIN="$TESTSERVER_DOMAIN"
# Seitenpasswort (Klartext) nur hier lesen, nie ausgeben.
SITE_PASSWORD="$(cat "$APP_DIR/site-password")"

log "Einstellungen (.env): Geheimnisse einmal erzeugen, danach behalten"
ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
gen() {
  case "$1" in
    __SECRET__) openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n' ;;
    __HEX32__) openssl rand -hex 32 ;;
    __KEY32__) openssl rand -base64 32 | tr -d '\n' ;;
    __S3_KEY_ID__) printf 'GK%s' "$(openssl rand -hex 12)" ;;
    *) printf '%s' "$1" ;;
  esac
}
setenv() { # setenv NAME WERT: Eintrag ersetzen oder anhängen
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.new" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}
while IFS='=' read -r name value; do
  [[ "$name" =~ ^[A-Z0-9_]+$ ]] || continue
  grep -q "^$name=" "$ENV_FILE" || setenv "$name" "$(gen "$value")"
done < "$APP_DIR/src/.env.example"
# Feste Werte für den Testserver (bei jedem Lauf gesetzt).
setenv SHOP_ENV test
setenv SHOP_DOMAIN "$DOMAIN"
setenv MAILPIT_UI_USER "$TESTSERVER_USER"
setenv MAILPIT_UI_PASSWORD "$SITE_PASSWORD"

log "Abbilder bauen (arm64, auf dem Server)"
for target in migrate api worker backoffice storefront; do
  docker build -q -f "$APP_DIR/src/infra/docker/Dockerfile" --target "$target" \
    -t "shop-platform/$target:local" "$APP_DIR/src" >/dev/null
done

# Vor M5 lief hier nur Caddy mit der Vorschau (Projekt shop-testserver). Es belegt 80/443.
if docker compose -p shop-testserver ps -q 2>/dev/null | grep -q .; then
  log "Alte Vorschau anhalten"
  docker compose -p shop-testserver down --remove-orphans
fi
rm -rf "$APP_DIR/site" "$APP_DIR/compose.yaml" "$APP_DIR/Caddyfile"

COMPOSE=(docker compose --project-directory "$APP_DIR/src/infra" -f "$APP_DIR/src/infra/compose.yaml"
  -f "$APP_DIR/src/infra/testserver/compose.testserver.yaml" --env-file "$ENV_FILE")

log "Container starten"
"${COMPOSE[@]}" up -d --no-build --wait --remove-orphans

log "Objektspeicher einrichten"
envget() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
garage() { "${COMPOSE[@]}" exec -T garage /garage "$@"; }
# Wie tools/dev.mjs (initGarage): Knoten einmal einteilen, dann Schlüssel und Bereiche.
node_id="$(garage status | grep -oE '^[0-9a-f]{16}' | head -1)"
[ -n "$node_id" ] || { echo "Garage: Knoten-ID nicht gefunden" >&2; exit 1; }
layout="$(garage layout show)"
if grep -qi "No nodes currently have a role" <<<"$layout" || ! grep -q "$node_id" <<<"$layout"; then
  current="$(grep -oiE 'Current cluster layout version:[[:space:]]*[0-9]+' <<<"$layout" | grep -oE '[0-9]+$' || echo 0)"
  garage layout assign -z server -c 20G "$node_id"
  garage layout apply --version "$((current + 1))"
fi
key_id="$(envget SHOP_S3_ACCESS_KEY_ID)"
garage key list | grep -q "$key_id" || garage key import --yes -n shop-app "$key_id" "$(envget SHOP_S3_SECRET_ACCESS_KEY)"
for bucket in "$(envget SHOP_S3_BUCKET_PUBLIC)" "$(envget SHOP_S3_BUCKET_PRIVATE)"; do
  garage bucket list | grep -qw "$bucket" || garage bucket create "$bucket"
  garage bucket allow --read --write "$bucket" --key "$key_id"
done
garage bucket website --allow "$(envget SHOP_S3_BUCKET_PUBLIC)"

log "Testshops und Testdaten (Passwort der Inhaberkonten = Seitenpasswort)"
"${COMPOSE[@]}" exec -T -e SHOP_SEED_PASSWORD="$SITE_PASSWORD" api node dist/seed.js

log "Alte Abbilder aufräumen"
docker image prune -f >/dev/null

"${COMPOSE[@]}" ps
log "Fertig"
