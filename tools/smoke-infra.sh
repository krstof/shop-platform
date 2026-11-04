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

echo "== API hinter Caddy (E4, Sicherheit 5.5)"
A="$("${C[@]}" -D - "https://api.$D/admin/v1/manufacturers")"
check "API: ohne Anmeldung 401" '[[ "$A" =~ ^HTTP/2\ 401 ]]'
check "API: Fehler als Problem Details" 'grep -qi "^content-type: application/problem+json" <<<"$A"'
check "API: requestId in Kopfzeile und Inhalt gleich" '[[ "$(grep -i "^x-request-id:" <<<"$A" | tr -d "\r" | cut -d" " -f2)" == "$(grep -o "\"requestId\":\"[^\"]*\"" <<<"$A" | cut -d\" -f4)" ]]'
for h in "content-security-policy: default-src 'none'" "x-content-type-options: nosniff" "x-frame-options: DENY" \
         "referrer-policy: no-referrer" "cache-control: no-store"; do
  check "API: Header $h" 'grep -qiF "$h" <<<"$A"'
done
check "API: kein Server-Header" '! grep -qi "^server:" <<<"$A"'
check "API: unbekannte Adresse 404 als Problem Details" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code} %{content_type}" "https://api.$D/admin/v1/gibt-es-nicht")" == "404 application/problem+json"* ]]'
check "API: Lebenszeichen /livez von außen gesperrt (404)" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://api.$D/livez")" == 404 ]]'
check "API: Anfrage über 1 MB abgewiesen (413)" '[[ "$(head -c 1100000 /dev/zero | tr "\0" a | "${C[@]}" -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" --data-binary @- "https://api.$D/admin/v1/manufacturers")" == 413 ]]'
check "API: Container ist gesund (Gesundheitscheck)" '[[ "$(docker inspect shop-platform-api-1 --format "{{.State.Health.Status}}")" == healthy ]]'
check "API: kein Internetzugang aus dem Container" '! docker exec shop-platform-api-1 node -e "fetch(\"https://example.com\",{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(1))"'
check "API: kein npm im Abbild" '! docker exec shop-platform-api-1 sh -c "command -v npm" >/dev/null'
check "API: Programmdateien nicht beschreibbar" '! docker exec shop-platform-api-1 sh -c "touch /app/dist/x" 2>/dev/null'
check "API: Abbild ohne Quellcode und Tests" '! docker exec shop-platform-api-1 sh -c "ls /app/src /app/node_modules/.pnpm | grep -qiE \"^src|vitest|typescript@\"" 2>/dev/null'
check "migrate: beendet mit Code 0" '[[ "$(docker inspect shop-platform-migrate-1 --format "{{.State.ExitCode}}")" == 0 ]]'
MU="$(docker inspect shop-platform-migrate-1 --format '{{.Config.User}} {{json .HostConfig.CapDrop}} {{.HostConfig.ReadonlyRootfs}} {{json .HostConfig.SecurityOpt}}')"
check "migrate: gehärtet wie die übrigen Container ($MU)" '[[ "$MU" == 1000:1000\ *ALL*\ true\ *no-new-privileges* ]]'

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

# Zum Schluss, weil die Bremse diesen Rechner danach eine Minute lang ausbremst.
echo "== Anfragebremse hinter Caddy (T-18, Sicherheit 5.8)"
# Der Eimer füllt sich mit 10 Marken je Sekunde wieder auf. Deshalb wird gezählt statt einzeln geprüft.
burst() { # $1 Anzahl, $2 Kopfzeile oder leer; gibt die Zahl der 429-Antworten aus
  local f; f="$(mktemp)"
  for i in $(seq 1 "$1"); do echo "url = \"https://api.$D/admin/v1/manufacturers?n=$i\""; echo "output = /dev/null"; done >"$f"
  "${C[@]}" --parallel --parallel-max 50 ${2:+-H "$2"} -K "$f" -w "%{http_code}\n" | grep -c '^429$'
  rm -f "$f"
}
N429="$(burst 800 "X-Forwarded-For: 203.0.113.7")"
check "800 Anfragen in Sekunden: die Bremse greift ($N429 × 429)" '[[ "$N429" -ge 100 ]]'
retry_after() { for _ in $(seq 1 20); do "${C[@]}" -D - -o /dev/null "https://api.$D/admin/v1/manufacturers" | grep -qi "^retry-after:" && return 0; done; return 1; }
check "429 kommt mit Retry-After" retry_after
NSPOOF="$(burst 50 "X-Forwarded-For: 198.51.100.$RANDOM")"
check "Gefälschtes X-Forwarded-For hebt die Bremse nicht auf ($NSPOOF von 50 × 429)" '[[ "$NSPOOF" -ge 35 ]]'
# Ein zweiter Absender im Netz vor Caddy: Ohne SHOP_TRUSTED_PROXY sähe die API für alle nur Caddy
# und bremste ihn mit aus (Gegenprobe am 04.11.2026).
EDGE_IP="$(docker inspect shop-platform-caddy-1 --format '{{(index .NetworkSettings.Networks "shop-platform_edge").IPAddress}}')"
OTHER="$(docker run --rm --network shop-platform_edge --add-host "api.$D:$EDGE_IP" --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges:true --entrypoint sh \
  caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f -c \
  "for i in \$(seq 1 30); do wget -S --no-check-certificate -O /dev/null https://api.$D/admin/v1/manufacturers 2>&1 | grep -m1 HTTP/; done" | grep -c ' 401')"
check "Anderer Absender bleibt frei, die API sieht echte Absender statt Caddy ($OTHER von 30 × 401)" '[[ "$OTHER" -eq 30 ]]'

if [[ $FAIL -eq 0 ]]; then echo "== Alle Prüfungen bestanden"; else echo "== Mindestens eine Prüfung ist fehlgeschlagen"; exit 1; fi
