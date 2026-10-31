#!/usr/bin/env bash
# `cloudplay cloudflare` y `cloudplay mail` contra un Cloudflare y un Resend falsos (tests/cloudflare/fake_apis.py)
# y la API REAL de CloudPlay (devserver): túnel, rutas, DNS, TURN, aplicar en el máster, estado, dominio de correo con
# SPF/DKIM/DMARC en Cloudflare, verificación, correo de prueba de verdad, idempotencia y vuelta a la red local.
# Imprime CF_MAIL_OK.
set -Eeuo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
FP=$(free_port) AP=$(free_port)
python3 "$HERE/fake_apis.py" "$FP" & PIDS+=($!)

# La API de CloudPlay de verdad, con el correo apuntando al Resend falso
( cd "$ROOT/control-plane" && rm -f "$T/dev.db" && CP_DATABASE_URL="sqlite+aiosqlite:///$T/dev.db" CP_MAIL_PROVIDER=resend \
  CP_RESEND_API_KEY=re_key CP_RESEND_API_BASE="http://127.0.0.1:$FP/resend" CP_MAIL_FROM="CloudPlay <no-reply@tudominio.com>" \
  python3 devserver.py "$AP" > "$T/api.log" 2>&1 ) & PIDS+=($!)
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$AP/api/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$FP/_state" >/dev/null 2>&1 && break; sleep 0.5; done

# Un máster en modo red local (lo que dejaría el clúster de Proxmox)
mkdir -p "$T/opt" "$T/etc"
cat > "$T/opt/.env" <<EOF
CP_DOMAIN=192.168.1.50
CP_ADMIN_EMAIL=admin@local
CP_ADMIN_PASSWORD=devpassword
TUNNEL_TOKEN=
EOF
printf '%q ' --role orchestrator --lan-ip 192.168.1.50 --images ghcr.io/x/cloudplay- --version v1.6.0 > "$T/etc/install.args"
cat > "$T/install.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$T/installs"
EOF
chmod +x "$T/install.sh"
export T CLOUDPLAY_TEST=1 CLOUDPLAY_DEST="$T/opt" CLOUDPLAY_ETC="$T/etc" CLOUDPLAY_INSTALL="$T/install.sh" CLOUDPLAY_DC=true \
  CF_API="http://127.0.0.1:$FP/cf" RESEND_API="http://127.0.0.1:$FP/resend" CLOUDPLAY_HEALTH_WAIT=0 \
  CLOUDPLAY_API_URL="http://127.0.0.1:$AP" CLOUDPLAY_VERIFY_WAIT=5 CLOUDPLAY_POLL=0
CF="$ROOT/deploy/install/cloudflare.sh" MAIL="$ROOT/deploy/install/mail.sh"
state() { curl -fsS "http://127.0.0.1:$FP/_state"; }
fail() { echo "FALLO: $*"; exit 1; }

# ---------------------------------------------------------------- 1) token malo
bash "$CF" --token malo --hostname play.tudominio.com </dev/null > "$T/o" 2>&1 && fail "con un token malo no debería seguir"
grep -q "Authentication error\|Ninguna zona" "$T/o" || fail "error del token: $(cat "$T/o")"

# ---------------------------------------------------------------- 2) hay un A en play: no se pisa sin --yes
bash "$CF" --token cf-token --hostname play.tudominio.com </dev/null > "$T/o" 2>&1 && fail "debería negarse a pisar el registro A"
grep -q "ya existe en Cloudflare (A → 203.0.113.7)" "$T/o" || fail "aviso del A: $(cat "$T/o")"
[ ! -f "$T/installs" ] || fail "no debería haber tocado el máster"
[ "$(state | jq '.tunnels | length')" = 0 ] || fail "no debería haber creado el túnel antes de confirmar los DNS"

# ---------------------------------------------------------------- 3) publicar
bash "$CF" --token cf-token --hostname Play.TuDominio.com --yes </dev/null > "$T/o" 2>&1 || { cat "$T/o"; fail "cloudflare setup"; }
cat "$T/o"
S=$(state)
[ "$(echo "$S" | jq '[.tunnels[]] | length')" = 1 ] || fail "un túnel"
TID=$(echo "$S" | jq -r '.tunnels | keys[0]')
echo "$S" | jq -e --arg t "$TID" '.tunnels[$t].name == "cloudplay-play-tudominio-com"' >/dev/null || fail "nombre del túnel"
echo "$S" | jq -e --arg t "$TID" '.configs[$t].ingress == [{"hostname":"play.tudominio.com","service":"http://caddy:80"},{"hostname":"s3.play.tudominio.com","service":"http://s3:8333"},{"service":"http_status:404"}]' >/dev/null \
  || fail "rutas: $(echo "$S" | jq -c --arg t "$TID" '.configs[$t]')"
for h in play.tudominio.com s3.play.tudominio.com; do
  echo "$S" | jq -e --arg h "$h" --arg c "$TID.cfargotunnel.com" '[.dns[] | select(.name == $h)] | length == 1 and .[0].type == "CNAME" and .[0].content == $c and .[0].proxied == true' >/dev/null \
    || fail "DNS de $h: $(echo "$S" | jq -c --arg h "$h" '[.dns[] | select(.name == $h)]')"
done
[ "$(echo "$S" | jq '.turn | length')" = 1 ] || fail "clave TURN"
[ "$(stat -c %a "$T/etc/cloudflare.env")" = 600 ] || fail "cloudflare.env debe ser solo de root"
INST=$(tail -n1 "$T/installs")
echo "$INST" | grep -q -- "--role orchestrator --images ghcr.io/x/cloudplay- --version v1.6.0 --domain play.tudominio.com --tunnel-token eyJtoken-${TID:0:8} --cf-turn-key-id [0-9a-f]* --cf-turn-token turnkey-.* --skip-build" \
  || fail "reinstalación: $INST"
echo "$INST" | grep -q -- "--lan-ip" && fail "con dominio ya no va --lan-ip"
grep -q "CloudPlay publicado: https://play.tudominio.com" "$T/o" || fail "resumen"

# ---------------------------------------------------------------- 4) repetir no duplica nada
bash "$CF" --yes </dev/null > "$T/o" 2>&1 || { cat "$T/o"; fail "segunda vez"; }
S=$(state)
[ "$(echo "$S" | jq '[.tunnels[]] | length')" = 1 ] || fail "segunda vez: otro túnel"
[ "$(echo "$S" | jq '[.dns[] | select(.type == "CNAME")] | length')" = 2 ] || fail "segunda vez: DNS duplicados"
[ "$(echo "$S" | jq '.turn | length')" = 1 ] || fail "segunda vez: otra clave TURN"
grep -q "ya existía" "$T/o" || fail "debería reutilizar el túnel"
grep -q "Túnel cloudplay-play-tudominio-com creado" "$T/o" && fail "la segunda vez no crea túnel"

# ---------------------------------------------------------------- 5) estado
bash "$CF" status > "$T/o" 2>&1 || true
grep -q "sano (4 conexiones" "$T/o" || fail "estado: $(cat "$T/o")"

# ---------------------------------------------------------------- 6) correo con Resend: dominio, DNS, verificación y prueba
bash "$MAIL" setup --provider resend --api-key re_key --domain TuDominio.com --yes </dev/null > "$T/o" 2>&1 || { cat "$T/o"; fail "mail setup"; }
cat "$T/o"
S=$(state)
echo "$S" | jq -e '[.domains[]] | length == 1 and .[0].region == "eu-west-1" and .[0].status == "verified"' >/dev/null || fail "dominio en Resend: $(echo "$S" | jq -c '.domains')"
for r in "TXT resend._domainkey.tudominio.com" "MX send.tudominio.com" "TXT send.tudominio.com" "TXT _dmarc.tudominio.com"; do
  set -- $r
  echo "$S" | jq -e --arg t "$1" --arg n "$2" '[.dns[] | select(.type == $t and .name == $n)] | length == 1' >/dev/null || fail "falta $r"
done
echo "$S" | jq -e '[.dns[] | select(.type == "MX" and .name == "send.tudominio.com")][0].priority == 10' >/dev/null || fail "prioridad del MX"
echo "$S" | jq -e '[.dns[] | select(.name == "links.tudominio.com")] | length == 0' >/dev/null || fail "el CNAME de seguimiento no hace falta"
grep -q "^CP_MAIL_PROVIDER=resend$" "$T/opt/.env" && grep -q "^CP_RESEND_API_KEY=re_key$" "$T/opt/.env" \
  && grep -q "^CP_MAIL_FROM=CloudPlay <no-reply@tudominio.com>$" "$T/opt/.env" && grep -q "^CP_RESEND_DOMAIN_ID=" "$T/opt/.env" || fail ".env del correo"
echo "$S" | jq -e '.emails[-1].to == ["admin@local"] and .emails[-1].subject == "Correo de prueba de CloudPlay"' >/dev/null \
  || fail "correo de prueba: $(echo "$S" | jq -c '.emails')"
grep -q "Correo de prueba enviado a admin@local" "$T/o" || fail "aviso de la prueba"

# ---------------------------------------------------------------- 7) repetir el correo no duplica DNS; prueba a mano; estado
n0=$(state | jq '.dns | length')
bash "$MAIL" setup --provider resend --api-key re_key --domain tudominio.com --yes </dev/null > "$T/o" 2>&1 || { cat "$T/o"; fail "mail setup 2"; }
[ "$(state | jq '.dns | length')" = "$n0" ] || fail "mail setup repetido duplica DNS"
[ "$(state | jq '[.domains[]] | length')" = 1 ] || fail "mail setup repetido crea otro dominio"
bash "$MAIL" test otra@tudominio.com > "$T/o" 2>&1 || { cat "$T/o"; fail "mail test"; }
state | jq -e '.emails[-1].to == ["otra@tudominio.com"]' >/dev/null || fail "mail test a otra dirección"
bash "$MAIL" status > "$T/o" 2>&1 || true
grep -q "Avisos del NOC a: admin@local" "$T/o" && grep -q "test → otra@tudominio.com: sent" "$T/o" || fail "mail status: $(cat "$T/o")"

# ---------------------------------------------------------------- 8) SMTP: solo configura (con opciones)
cp "$T/opt/.env" "$T/env.bak"
bash "$MAIL" setup --provider smtp --smtp-host smtp.ejemplo.com --smtp-port 465 --smtp-user u --smtp-password 'p@ss w' \
  --from no-reply@ejemplo.com --yes </dev/null > "$T/o" 2>&1 || { cat "$T/o"; fail "mail smtp"; }
grep -q "^CP_SMTP_SECURITY=ssl$" "$T/opt/.env" && grep -q "^CP_SMTP_PASSWORD=p@ss w$" "$T/opt/.env" && grep -q "^CP_MAIL_PROVIDER=smtp$" "$T/opt/.env" \
  || fail ".env SMTP"
[ "$(stat -c %a "$T/opt/.env")" = 600 ] || fail ".env debe ser solo de root"
cp "$T/env.bak" "$T/opt/.env"

# ---------------------------------------------------------------- 9) dejar de publicar y borrar lo creado
bash "$CF" off --delete --yes </dev/null > "$T/o" 2>&1 || { cat "$T/o"; fail "cloudflare off"; }
S=$(state)
echo "$S" | jq -e --arg t "$TID" '.tunnels[$t].deleted == true' >/dev/null || fail "túnel sin borrar"
[ "$(echo "$S" | jq '[.dns[] | select(.type == "CNAME")] | length')" = 0 ] || fail "CNAME sin borrar"
[ "$(echo "$S" | jq '[.dns[] | select(.name == "resend._domainkey.tudominio.com")] | length')" = 1 ] || fail "no debe tocar los DNS del correo"
[ "$(echo "$S" | jq '.turn | length')" = 0 ] || fail "clave TURN sin borrar"
[ ! -f "$T/etc/cloudflare.env" ] || fail "cloudflare.env sigue"
grep -q "^TUNNEL_TOKEN=$" "$T/opt/.env" || fail "TUNNEL_TOKEN sin vaciar"
tail -n1 "$T/installs" | grep -q -- "--role orchestrator --images ghcr.io/x/cloudplay- --version v1.6.0 --lan-ip [0-9.]* --skip-build" \
  || fail "vuelta a red local: $(tail -n1 "$T/installs")"

echo CF_MAIL_OK
