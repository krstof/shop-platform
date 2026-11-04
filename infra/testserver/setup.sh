#!/usr/bin/env bash
# =============================================================================
# Richtet den Testserver ein (docs/07_Testserver.md). Läuft als root auf dem
# Server, aufgerufen vom GitHub-Ablauf `.github/workflows/testserver.yml`.
# Darf beliebig oft laufen: Jeder Schritt prüft erst, ob er schon erledigt ist.
#
# Erwartet im selben Ordner: compose.yaml, Caddyfile, secrets.env, site.tar.gz (gebaute Storefront)
# =============================================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/shop-testserver
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Muss als root laufen." >&2; exit 1; }
for f in compose.yaml Caddyfile secrets.env site.tar.gz; do
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

# --- 5. Anwendung (Caddy liefert die Vorschau der Storefront aus) -------------
log "Dateien nach $APP_DIR"
install -d -m 0750 "$APP_DIR"
install -m 0644 "$SRC/compose.yaml" "$APP_DIR/compose.yaml"
install -m 0644 "$SRC/Caddyfile" "$APP_DIR/Caddyfile"
install -m 0600 "$SRC/secrets.env" "$APP_DIR/secrets.env"

log "Storefront-Vorschau auspacken"
# Erst in einen neuen Ordner auspacken und prüfen, dann den Inhalt austauschen. Der Ordner selbst
# bleibt derselbe, weil Caddy ihn eingebunden hat (ein umbenannter Ordner wäre für Caddy unsichtbar).
rm -rf "$APP_DIR/site.new"
install -d -m 0755 "$APP_DIR/site.new" "$APP_DIR/site"
tar -xzf "$SRC/site.tar.gz" -C "$APP_DIR/site.new" --no-same-owner --no-same-permissions
[ -s "$APP_DIR/site.new/index.html" ] || { echo "index.html fehlt im Paket" >&2; exit 1; }
chown -R root:root "$APP_DIR/site.new"
chmod -R u=rwX,go=rX "$APP_DIR/site.new"
find "$APP_DIR/site" -mindepth 1 -delete
cp -a "$APP_DIR/site.new/." "$APP_DIR/site/"
rm -rf "$APP_DIR/site.new"

log "Container starten"
docker compose -f "$APP_DIR/compose.yaml" --project-directory "$APP_DIR" up -d --wait --remove-orphans
docker compose -f "$APP_DIR/compose.yaml" --project-directory "$APP_DIR" ps

log "Fertig"
