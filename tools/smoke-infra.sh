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
check "API: Abbild ohne Quellcode und Tests" '! docker exec shop-platform-api-1 sh -c "ls /app/src /app/node_modules/.pnpm | grep -qiE \"^src$|^(vitest|@vitest[+]|typescript|vite)@\"" 2>/dev/null'

echo "== Anmeldung (E6, Sicherheit 5.2 und 5.5)"
SIGNIN=(-X POST -H "Content-Type: application/json" --data '{"email":"niemand@teeladen.example","password":"drei kleine teekannen"}')
L="$("${C[@]}" -D - "${SIGNIN[@]}" -H "Origin: https://admin.$D" "https://api.$D/auth/v1/sign-in")"
# 401 heißt: Argon2id lief im Container (passender Baustein für musl/arm64 vorhanden) und shop_auth erreicht die Datenbank.
check "Anmeldung: unbekannte E-Mail ergibt 401 invalid_credentials" '[[ "$L" =~ ^HTTP/2\ 401 ]] && grep -q "\"code\":\"invalid_credentials\"" <<<"$L"'
check "Anmeldung: kein Cookie bei Fehlschlag" '! grep -qi "^set-cookie:" <<<"$L"'
check "Anmeldung: fremde Herkunft ergibt 403" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "${SIGNIN[@]}" -H "Origin: https://evil.example" "https://api.$D/auth/v1/sign-in")" == 403 ]]'
check "Anmeldung: „Wer bin ich“ ohne Cookie 401" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://api.$D/auth/v1/session")" == 401 ]]'
check "Anmeldung: Liste bekannter Passwörter im Abbild" 'docker exec shop-platform-api-1 sh -c "test -s /app/node_modules/@shop/identity/dist/internal/data/common-passwords.txt.gz"'
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
check "API: Anmeldemodul ist als shop_auth verbunden" '[[ "$(PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" "${PSQL[@]}" -U postgres -c "SELECT count(*) FROM pg_stat_activity WHERE usename = '"'"'shop_auth'"'"' AND application_name = '"'"'identity'"'"'")" -ge 1 ]]'
# Testdaten (M1): legt Teeladen und Modeladen an (zweiter Lauf ändert nichts), schreibt als shop_platform.
# Ausgabe erst ganz abwarten: grep -q beendet sich beim ersten Treffer, und mit pipefail würde der
# abgebrochene Seed-Befehl (SIGPIPE) die Prüfung zufällig scheitern lassen.
check "Testdaten: pnpm dev:seed legt die Testshops an" 'docker exec shop-platform-api-1 node dist/seed.js >/dev/null && SEED_OUT="$(docker exec shop-platform-api-1 node dist/seed.js)" && grep -q "Teeladen: gibt es schon" <<<"$SEED_OUT"'
# Bilder (M2 Teil 2): Testprodukte haben Bilder, die über media.<Domain> als WebP kommen.
IMG_KEY="$(PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" "${PSQL[@]}" -U postgres -c "SELECT storage_key FROM media.media_rendition WHERE preset = 'w400' LIMIT 1")"
check "Bilder: Testprodukte haben Bilder (pnpm dev:seed)" '[[ "$IMG_KEY" == tenants/*/w400.webp ]]'
IMG_H="$("${C[@]}" -D - -o /dev/null "https://media.$D/$IMG_KEY")"
check "Bilder: über media.$D als WebP mit langer Gültigkeit" 'grep -qiE "^HTTP/2 200" <<<"$IMG_H" && grep -qi "content-type: image/webp" <<<"$IMG_H" && grep -qi "immutable" <<<"$IMG_H"'
check "Bilder: Originale sind nicht öffentlich" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://media.$D/${IMG_KEY%w400.webp}original")" == 404 ]]'

echo "== Backoffice (M3)"
BH="$("${C[@]}" -D - -o /dev/null "https://admin.$D/teeladen/produkte")"
check "Backoffice: Seiten unter admin.$D (auch tiefe Links) mit 200" '[[ "$BH" =~ ^HTTP/2\ 200 ]]'
check "Backoffice: strenge CSP (nur eigene Skripte, keine fremden Rahmen)" 'grep -qiE "content-security-policy: .*script-src '"'"'self'"'"';.*frame-ancestors '"'"'none'"'"'" <<<"$BH"'
check "Backoffice: Seite wird nicht zwischengespeichert" 'grep -qi "cache-control: no-cache" <<<"$BH"'
check "Backoffice: API unter derselben Adresse (Auth-API antwortet 401)" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://admin.$D/auth/v1/session")" == 401 ]]'
check "Backoffice: ändernde Anfragen an die Dateien abgelehnt" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" -X POST "https://admin.$D/index.html")" == 405 ]]'
check "Backoffice: Container ohne Ports nach außen" '[[ -z "$(docker port shop-platform-backoffice-1)" ]]'

echo "== Storefront (M4)"
SH="$("${C[@]}" -D /tmp/smoke-sf-h -o /tmp/smoke-sf "https://shop.$D/teeladen"; cat /tmp/smoke-sf-h)"
check "Storefront: Teeladen unter shop.$D/teeladen mit 200" '[[ "$SH" =~ ^HTTP/2\ 200 ]]'
check "Storefront: Produkte und Bilder aus der API" 'grep -q "Sencha Frühlingshauch" /tmp/smoke-sf && grep -q "https://media.$D/tenants/" /tmp/smoke-sf'
check "Storefront: strenge CSP ohne Skripte" 'grep -qiE "content-security-policy: default-src '"'"'none'"'"'; style-src '"'"'self'"'"'; img-src" <<<"$SH" && ! grep -qi "<script" /tmp/smoke-sf'
check "Storefront: unbekannter Shop ergibt 404" '[[ "$("${C[@]}" -o /dev/null -w "%{http_code}" "https://shop.$D/gibt-es-nicht")" == 404 ]]'
check "Storefront: Container ohne Datenbank-Zugang (keine Geheimnisse)" '! docker exec shop-platform-storefront-1 env | grep -qiE "DATABASE|SECRET|PASSWORD"'

echo "== Worker: Hintergrunddienst (E5)"
W=shop-platform-worker-1
check "Worker: Container ist gesund (Lebenszeichen)" '[[ "$(docker inspect $W --format "{{.State.Health.Status}}")" == healthy ]]'
check "Worker: keine Ports nach außen" '[[ -z "$(docker port $W)" ]]'
check "Worker: nur im internen Netz" '[[ "$(docker inspect $W --format "{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}")" == "shop-platform_internal " ]]'
check "Worker: Lebenszeichen von anderen Containern nicht erreichbar" '! docker exec shop-platform-api-1 wget -q -T 3 -O /dev/null http://worker:3001/livez 2>/dev/null'
check "Worker: kein Internetzugang aus dem Container" '! docker exec $W node -e "fetch(\"https://example.com\",{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(1))"'
check "Worker: kein npm im Abbild" '! docker exec $W sh -c "command -v npm" >/dev/null'
check "Worker: Programmdateien nicht beschreibbar" '! docker exec $W sh -c "touch /app/dist/x" 2>/dev/null'
check "Worker: Abbild ohne Quellcode und Tests" '! docker exec $W sh -c "ls /app/src /app/node_modules/.pnpm | grep -qiE \"^src|vitest|typescript@|testcontainers\"" 2>/dev/null'
# Die Verbindung als shop_app baut der Worker erst bei Arbeit auf, deshalb: keine andere Rolle, shop_relay dabei.
WROLES="$(PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" "${PSQL[@]}" -U postgres -c "SELECT count(*) FILTER (WHERE usename NOT IN ('shop_app','shop_relay')) || '/' || count(*) FILTER (WHERE usename = 'shop_relay') FROM pg_stat_activity WHERE application_name LIKE 'worker%'")"
check "Worker: meldet sich nur als shop_app oder shop_relay an, nie als Verwaltung (andere/relay: $WROLES)" '[[ "$WROLES" =~ ^0/[1-9] ]]'
# Ende zu Ende: Bis E6 kann sich niemand an der API anmelden. Der Rauchtest schreibt deshalb als
# shop_app genau das, was die API beim Anlegen eines Herstellers schreibt (Hersteller und Ereignis in
# EINER Transaktion), und wartet, bis der Worker es ins Änderungsprotokoll gebracht hat.
SU=(env PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" "${PSQL[@]}" -U postgres)
TENANT="$("${SU[@]}" -c "SELECT id FROM platform.tenant WHERE handle = 'rauchtest'")"
if [[ -z "$TENANT" ]]; then
  TENANT="$("${SU[@]}" -c "WITH m AS (INSERT INTO platform.merchant (name) VALUES ('Rauchtest') RETURNING id)
    INSERT INTO platform.tenant (merchant_id, plan_id, handle, name, status)
    SELECT m.id, p.id, 'rauchtest', 'Rauchtest-Shop', 'active' FROM m, platform.plan p WHERE p.is_default RETURNING id" | head -1)"
fi
MID="$("${SU[@]}" -c "SELECT uuidv7()")"
# Mit -i, damit psql den Text unten bekommt.
docker exec -i -e PGPASSWORD="$SHOP_DB_PASSWORD_APP" shop-platform-postgres-1 psql -h 127.0.0.1 -X -q -tA \
  -d "${SHOP_DB_NAME:-shop}" -U shop_app -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
SELECT set_config('app.tenant_id', '$TENANT', true);
INSERT INTO catalog.manufacturer (tenant_id, id, name) VALUES (kernel.current_tenant_id(), '$MID', 'Rauchtest-Hersteller');
INSERT INTO kernel.outbox (tenant_id, type, actor, correlation_id, data)
VALUES (kernel.current_tenant_id(), 'catalog.manufacturer.created.v1', '{"type":"system"}', uuidv7(),
        jsonb_build_object('id', '$MID'::uuid, 'name', 'Rauchtest-Hersteller'));
COMMIT;
SQL
audit_entry() { for _ in $(seq 1 40); do
  [[ "$("${SU[@]}" -c "SELECT count(*) FROM audit.audit_entry WHERE tenant_id = '$TENANT' AND entity_id = '$MID' AND action = 'catalog.manufacturer.created.v1'")" == 1 ]] && return 0
  sleep 0.5; done; return 1; }
check "Worker: neuer Hersteller erscheint genau einmal im Änderungsprotokoll" audit_entry
check "Worker: Ereignis in der Outbox als weitergeleitet markiert" '[[ "$("${SU[@]}" -c "SELECT published_at IS NOT NULL FROM kernel.outbox WHERE data->>\$\$id\$\$ = \$\$$MID\$\$")" == t ]]'
check "Worker: Aufräumen ist stündlich eingeplant" '[[ "$("${SU[@]}" -c "SELECT cron FROM pgboss.schedule WHERE name = \$\$kernel.cleanup\$\$")" == "17 * * * *" ]]'

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
