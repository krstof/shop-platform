#!/usr/bin/env bash
# =============================================================================
# Rauchtest der lokalen Infrastruktur (Etappe E1). Erwartet laufende Container
# (`pnpm dev`). Prüft HTTPS, Sicherheits-Header, Passwortschutz von Mailpit,
# Objektspeicher und Bildauslieferung sowie die Härtung aller Container.
# Aufruf: pnpm test:infra
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
D="${SHOP_DOMAIN}"
C=(curl --noproxy '*' -sk --max-time 10)
FAIL=0
ok()   { echo "OK   $1"; }
fail() { echo "FEHL $1"; FAIL=1; }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }

echo "== HTTPS und Sicherheits-Header (Sicherheit 5.5)"
H="$("${C[@]}" -D - -o /dev/null "https://$D/")"
check "Startseite antwortet mit 200 über HTTPS" '[[ "$H" =~ ^HTTP/2\ 200 ]]'
for h in "x-content-type-options: nosniff" "referrer-policy: strict-origin-when-cross-origin" \
         "permissions-policy: camera=(), microphone=(), geolocation=(), payment=()" \
         "cross-origin-opener-policy: same-origin" "content-security-policy:" "cache-control: no-store"; do
  check "Header vorhanden: $h" 'grep -qiF "$h" <<<"$H"'
done
check "Kein Server-Header (verrät keine Software)" '! grep -qi "^server:" <<<"$H"'
check "Kein HTTP/3-Angebot (UDP ist nicht freigegeben)" '! grep -qi "^alt-svc:" <<<"$H"'
R="$("${C[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$D/")"
check "HTTP leitet auf HTTPS um ($R)" '[[ "$R" =~ ^30[18]\ https:// ]]'

echo "== Test-Mails (Mailpit)"
check "Ohne Passwort: 401" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://mail.$D/")" == 401 ]]'
check "Mit Passwort: 200" '[[ "$("${C[@]}" -u "$MAILPIT_UI_USER:$MAILPIT_UI_PASSWORD" -o /dev/null -w "%{http_code}" "https://mail.$D/")" == 200 ]]'

echo "== Objektspeicher und Bildauslieferung (Sicherheit 5.7)"
S3=(curl --noproxy '*' -s --max-time 10 --aws-sigv4 "aws:amz:garage:s3" --user "$SHOP_S3_ACCESS_KEY_ID:$SHOP_S3_SECRET_ACCESS_KEY")
OBJ="smoke-$(date +%s).txt"; BODY="rauchtest-$RANDOM"
check "Hochladen in den öffentlichen Speicher" '[[ "$(printf %s "$BODY" | "${S3[@]}" -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: text/plain" --data-binary @- "http://127.0.0.1:$SHOP_S3_PORT/$SHOP_S3_BUCKET_PUBLIC/$OBJ")" == 200 ]]'
check "Hochladen in den privaten Speicher" '[[ "$(printf %s "$BODY" | "${S3[@]}" -o /dev/null -w "%{http_code}" -X PUT --data-binary @- "http://127.0.0.1:$SHOP_S3_PORT/$SHOP_S3_BUCKET_PRIVATE/$OBJ")" == 200 ]]'
check "Ohne Schlüssel kein Zugriff auf den Speicher" '[[ "$(curl --noproxy "*" -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SHOP_S3_PORT/$SHOP_S3_BUCKET_PRIVATE/$OBJ")" == 403 ]]'
M="$("${C[@]}" -D - "https://media.$D/$OBJ")"
check "media.$D liefert die öffentliche Datei aus" 'grep -qF "$BODY" <<<"$M"'
check "media.$D: Cross-Origin-Resource-Policy cross-origin" 'grep -qi "cross-origin-resource-policy: cross-origin" <<<"$M"'
check "media.$D: nosniff" 'grep -qi "x-content-type-options: nosniff" <<<"$M"'
check "media.$D: keine Cookies" '! grep -qi "^set-cookie:" <<<"$M"'
check "media.$D: private Dateien sind nicht erreichbar" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://media.$D/../$SHOP_S3_BUCKET_PRIVATE/$OBJ")" =~ ^40[34]$ ]]'
check "media.$D: Schreiben ist verboten (405)" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" -X PUT --data x "https://media.$D/$OBJ")" == 405 ]]'
"${S3[@]}" -o /dev/null -X DELETE "http://127.0.0.1:$SHOP_S3_PORT/$SHOP_S3_BUCKET_PUBLIC/$OBJ"
"${S3[@]}" -o /dev/null -X DELETE "http://127.0.0.1:$SHOP_S3_PORT/$SHOP_S3_BUCKET_PRIVATE/$OBJ"

echo "== Erreichbarkeit"
check "Mailpit ist nicht direkt vom Rechner erreichbar" '! curl --noproxy "*" -s --max-time 3 -o /dev/null http://127.0.0.1:8025/'
check "Datenbank lauscht nur auf 127.0.0.1" '[[ "$(docker port shop-platform-postgres-1 5432)" == 127.0.0.1:* ]]'
PSQL=(docker exec -e PGPASSWORD shop-platform-postgres-1 psql -h 127.0.0.1 -X -q -tA -d "${SHOP_DB_NAME:-shop}")
check "Migrationen sind ausgeführt (mindestens 20)" '[[ "$(PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" "${PSQL[@]}" -U postgres -c "SELECT count(*) FROM shop_migration.checksum")" -ge 20 ]]'
check "shop_app meldet sich mit dem Passwort aus .env an" '[[ "$(PGPASSWORD="$SHOP_DB_PASSWORD_APP" "${PSQL[@]}" -U shop_app -c "SELECT current_user")" == shop_app ]]'
check "shop_app ohne richtiges Passwort: abgewiesen" '! PGPASSWORD="falsch-$RANDOM" "${PSQL[@]}" -U shop_app -c "SELECT 1" >/dev/null 2>&1'

echo "== Härtung der Container (Sicherheit 5.16)"
for c in $(docker ps --filter label=com.docker.compose.project=shop-platform --format '{{.Names}}'); do
  U="$(docker inspect "$c" --format '{{.Config.User}}')"
  CAPS="$(docker inspect "$c" --format '{{json .HostConfig.CapDrop}}')"
  NNP="$(docker inspect "$c" --format '{{json .HostConfig.SecurityOpt}}')"
  RO="$(docker inspect "$c" --format '{{.HostConfig.ReadonlyRootfs}}')"
  check "$c läuft nicht als root (User=$U)" '[[ -n "$U" && "$U" != 0* && "$U" != root* ]]'
  check "$c ohne Linux-Sonderrechte (cap_drop ALL)" '[[ "$CAPS" == *ALL* ]]'
  check "$c mit no-new-privileges" '[[ "$NNP" == *no-new-privileges* ]]'
  check "$c mit schreibgeschütztem Dateisystem" '[[ "$RO" == true ]]'
done

if [[ $FAIL -eq 0 ]]; then echo "== Alle Prüfungen bestanden"; else echo "== Mindestens eine Prüfung ist fehlgeschlagen"; exit 1; fi
