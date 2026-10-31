#!/usr/bin/env bash
# CloudPlay · correo del máster en un comando (lo llama `sudo cloudplay mail ...`).
#
#   cloudplay mail setup [--provider resend|smtp] [--api-key K] [--domain tudominio.com] [--from no-reply@…] [--yes]
#                        [--smtp-host H --smtp-port 587 --smtp-user U --smtp-password P --smtp-security starttls|ssl|none]
#   cloudplay mail status
#   cloudplay mail test [correo]
#   cloudplay mail off
#
# Resend (recomendado): da de alta el dominio en Resend, escribe sus registros SPF y DKIM y un DMARC en Cloudflare (si el
# máster está enlazado con «cloudplay cloudflare»; si no, te los enseña para ponerlos a mano), lo verifica, configura
# CloudPlay y manda un correo de prueba. SMTP: cualquier servidor (Gmail, Brevo, SES, Mailgun, el de tu empresa…).
# Qué correos salen y a quién avisar se cambia después en el panel (/#/admin → Correo).
set -Eeuo pipefail

DEST="${CLOUDPLAY_DEST:-/opt/cloudplay}"
ETC="${CLOUDPLAY_ETC:-/etc/cloudplay}"
ENV="$DEST/.env"
CF_ENV="$ETC/cloudflare.env"
CF_API="${CF_API:-https://api.cloudflare.com/client/v4}"
RESEND_API="${RESEND_API:-https://api.resend.com}"
DC="${CLOUDPLAY_DC:-docker compose}"
VERIFY_WAIT="${CLOUDPLAY_VERIFY_WAIT:-240}"
POLL="${CLOUDPLAY_POLL:-10}"

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }
get_env() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- || true; }
set_env() {
  local file="$1" key="$2" val="$3" tmp
  touch "$file"; tmp=$(mktemp)
  awk -v k="$key" -v v="$val" 'BEGIN{d=0} index($0,k"=")==1 {print k"="v; d=1; next} {print} END{if(!d) print k"="v}' "$file" > "$tmp"
  cat "$tmp" > "$file"; rm -f "$tmp"
}
ask() {  # variable, pregunta, [secreto]
  [ -t 0 ] || die "Falta $2 (pásalo como opción)"
  local v
  if [ "${3:-}" = secret ]; then read -r -s -p "  $2: " v; echo; else read -r -p "  $2: " v; fi
  printf -v "$1" '%s' "$v"
}

PROVIDER="" KEY="" DOMAIN="" FROM="" YES=0
SMTP_HOST="" SMTP_PORT="" SMTP_USER="" SMTP_PASSWORD="" SMTP_SECURITY=""
CMD="${1:-status}"; shift || true
TEST_TO=""
if [ "$CMD" = test ] && [ $# -gt 0 ] && [[ "$1" != --* ]]; then TEST_TO="$1"; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --provider) PROVIDER="$2"; shift ;;
    --api-key) KEY="$2"; shift ;;
    --domain) DOMAIN="$2"; shift ;;
    --from) FROM="$2"; shift ;;
    --smtp-host) SMTP_HOST="$2"; shift ;;
    --smtp-port) SMTP_PORT="$2"; shift ;;
    --smtp-user) SMTP_USER="$2"; shift ;;
    --smtp-password) SMTP_PASSWORD="$2"; shift ;;
    --smtp-security) SMTP_SECURITY="$2"; shift ;;
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
  shift
done
command -v jq >/dev/null || die "Falta jq (apt install jq)"
[ -f "$ENV" ] || die "Esto va en el máster (orquestador) de CloudPlay"

# ------------------------------------------------------------------ APIs
rs() {  # MÉTODO RUTA [JSON] → cuerpo; error legible si Resend dice que no
  local out code
  out=$(curl -sS -m 30 -w '\n%{http_code}' -X "$1" "$RESEND_API$2" -H "Authorization: Bearer $KEY" \
        -H "Content-Type: application/json" -H "User-Agent: CloudPlay" ${3:+--data "$3"}) || { echo "sin conexión con Resend" >&2; return 1; }
  code="${out##*$'\n'}" out="${out%$'\n'*}"
  if [ "${code:0:1}" != 2 ]; then
    echo "Resend $code: $(echo "$out" | jq -r '.message // .name // "error"' 2>/dev/null || echo "$out")" >&2
    return 1
  fi
  echo "$out"
}
cf() {
  local out
  out=$(curl -sS -m 30 -X "$1" "$CF_API$2" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
        ${3:+--data "$3"}) || return 1
  [ "$(echo "$out" | jq -r '.success // false' 2>/dev/null)" = true ] || { echo "$out" | jq -r '[.errors[]?.message] | join("; ")' >&2 2>/dev/null; return 1; }
  echo "$out" | jq -c '.result'
}
find_zone() {
  local cand="$1" z
  while [[ "$cand" == *.* ]]; do
    z=$(cf GET "/zones?name=$cand&status=active" | jq -c '.[0] // empty') || return 1
    if [ -n "$z" ]; then echo "$z"; return 0; fi
    cand="${cand#*.}"
  done
  return 1
}
# Registro DNS idempotente: TXT/MX se añaden si no están; el DKIM (un solo valor por nombre) se sustituye
put_record() {  # zona tipo nombre valor [prioridad]
  local recs body
  recs=$(cf GET "/zones/$1/dns_records?type=$2&name=$3") || return 1
  if echo "$recs" | jq -e --arg v "$4" 'map(.content | gsub("^\"|\"$"; "")) | index($v)' >/dev/null; then return 0; fi
  body=$(jq -nc --arg t "$2" --arg n "$3" --arg c "$4" --arg p "${5:-}" \
    '{type: $t, name: $n, content: $c, ttl: 1, comment: "CloudPlay · correo"} + (if $p != "" then {priority: ($p | tonumber)} else {} end)')
  if [[ "$3" == *._domainkey.* ]] && [ "$(echo "$recs" | jq 'length')" -gt 0 ]; then
    cf PUT "/zones/$1/dns_records/$(echo "$recs" | jq -r '.[0].id')" "$body" >/dev/null
  else
    cf POST "/zones/$1/dns_records" "$body" >/dev/null
  fi
}

# API de CloudPlay como administrador (la del .env): por dentro del contenedor, o por URL en pruebas
cp_api() {  # MÉTODO RUTA [JSON]
  if [ -n "${CLOUDPLAY_API_URL:-}" ]; then
    local tok
    tok=$(curl -fsS -X POST "$CLOUDPLAY_API_URL/api/auth/login" -H 'content-type: application/json' \
      -d "$(jq -nc --arg e "$(get_env "$ENV" CP_ADMIN_EMAIL)" --arg p "$(get_env "$ENV" CP_ADMIN_PASSWORD)" '{email:$e,password:$p}')" | jq -r .access_token)
    curl -sS -X "$1" "$CLOUDPLAY_API_URL$2" -H "authorization: Bearer $tok" -H 'content-type: application/json' ${3:+-d "$3"}
    return
  fi
  (cd "$DEST" && $DC exec -T -e M="$1" -e P="$2" -e B="${3:-}" api-a python - <<'PY'
import json, os, urllib.error, urllib.request
base = "http://127.0.0.1:8000"
def call(m, p, body=None, tok=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    r = urllib.request.Request(base + p, data=body.encode() if body else None, headers=h, method=m)
    try:
        return urllib.request.urlopen(r, timeout=30).read().decode()
    except urllib.error.HTTPError as e:
        return e.read().decode()
tok = json.loads(call("POST", "/api/auth/login", json.dumps({"email": os.environ["CP_ADMIN_EMAIL"], "password": os.environ["CP_ADMIN_PASSWORD"]})))["access_token"]
print(call(os.environ["M"], os.environ["P"], os.environ.get("B") or None, tok))
PY
  )
}

# Las dos réplicas de la API, de una en una: nadie se queda sin servicio
restart_api() {
  if [ -n "${CLOUDPLAY_API_URL:-}" ]; then return 0; fi
  local r
  for r in api-a api-b; do
    (cd "$DEST" && $DC up -d --no-deps --force-recreate "$r" >/dev/null)
    for _ in $(seq 1 90); do
      (cd "$DEST" && $DC exec -T "$r" python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/ready',timeout=2)") >/dev/null 2>&1 && break
      sleep 2
    done
  done
}

send_test() {  # [correo]
  local to="${1:-$(get_env "$ENV" CP_ADMIN_EMAIL)}" r
  r=$(cp_api POST /api/admin/mail/test "$(jq -nc --arg t "$to" '{to: $t}')")
  if echo "$r" | jq -e '.ok' >/dev/null 2>&1; then ok "Correo de prueba enviado a $to"
  else warn "La prueba no ha salido: $(echo "$r" | jq -r '.detail // .' 2>/dev/null)"; return 1; fi
}

# ------------------------------------------------------------------ setup
setup_resend() {
  [ -n "$KEY" ] || ask KEY "API key de Resend (resend.com → API Keys → Create, con «Full access»)" secret
  local base dom did recs st t0 zone="" zid="" n t v p name
  base=$(get_env "$ENV" CP_DOMAIN)
  if [ -z "$DOMAIN" ]; then
    if [[ "$base" =~ ^[0-9.]+$ ]] || [ -z "$base" ]; then
      ask DOMAIN "Dominio desde el que se envía (uno tuyo, p. ej. tudominio.com)"
    else
      DOMAIN="$base"
      if [ "$YES" = 0 ] && [ -t 0 ]; then
        read -r -p "  Dominio desde el que se envía [$base]: " v; DOMAIN="${v:-$base}"
      fi
    fi
  fi
  DOMAIN=$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's#^[a-z]*://##; s#/.*##; s#^.*@##')
  [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "Dominio no válido: $DOMAIN"
  FROM="${FROM:-no-reply@$DOMAIN}"
  [[ "$FROM" == *"@$DOMAIN" ]] || [[ "$FROM" == *"@$DOMAIN>" ]] || die "El remitente ($FROM) tiene que ser de $DOMAIN"

  say "Dominio $DOMAIN en Resend"
  dom=$(rs GET /domains | jq -c --arg d "$DOMAIN" '.data[]? | select(.name == $d)' | head -n1) || die "Resend no acepta la API key"
  if [ -z "$dom" ]; then
    dom=$(rs POST /domains "$(jq -nc --arg d "$DOMAIN" '{name: $d, region: "eu-west-1"}')") || die "No se pudo dar de alta $DOMAIN en Resend"
    ok "Dado de alta en Resend (región UE)"
  else
    ok "Ya estaba en Resend"
  fi
  did=$(echo "$dom" | jq -r '.id')
  recs=$(rs GET "/domains/$did" | jq -c '.records') || die "No se pudieron leer los registros de $DOMAIN"

  # DNS: en Cloudflare si el máster está enlazado y el dominio es de esa cuenta; si no, a mano
  if [ -f "$CF_ENV" ]; then
    # shellcheck disable=SC1090
    . "$CF_ENV"
    zone=$(find_zone "$DOMAIN" 2>/dev/null) || zone=""
  fi
  if [ -n "$zone" ]; then
    zid=$(echo "$zone" | jq -r '.id')
    say "Escribiendo SPF, DKIM y DMARC en Cloudflare ($(echo "$zone" | jq -r .name))"
    n=$(echo "$recs" | jq 'length')
    for i in $(seq 0 $((n - 1))); do
      t=$(echo "$recs" | jq -r ".[$i].type") name=$(echo "$recs" | jq -r ".[$i].name") v=$(echo "$recs" | jq -r ".[$i].value")
      p=$(echo "$recs" | jq -r ".[$i].priority // empty")
      [ "$(echo "$recs" | jq -r ".[$i].record")" = Tracking ] && continue
      put_record "$zid" "$t" "$name.$DOMAIN" "$v" "$p" || die "No se pudo escribir $t $name.$DOMAIN en Cloudflare"
      echo "    $t $name.$DOMAIN"
    done
    if [ "$(cf GET "/zones/$zid/dns_records?type=TXT&name=_dmarc.$DOMAIN" | jq 'length')" = 0 ]; then
      put_record "$zid" TXT "_dmarc.$DOMAIN" "v=DMARC1; p=none; adkim=r; aspf=r" && echo "    TXT _dmarc.$DOMAIN (DMARC)"
    fi
    ok "DNS del correo en Cloudflare"
  else
    warn "Pon estos registros en el DNS de $DOMAIN (el máster no está enlazado con Cloudflare o el dominio no es de esa cuenta):"
    echo "$recs" | jq -r '.[] | select(.record != "Tracking") | "    \(.type)\t\(.name).'"$DOMAIN"'\t\(.value)\(if .priority then "\t(prioridad \(.priority))" else "" end)"'
    echo "    TXT	_dmarc.$DOMAIN	v=DMARC1; p=none; adkim=r; aspf=r"
    if [ -t 0 ] && [ "$YES" = 0 ]; then read -r -p "  Pulsa Intro cuando estén puestos… " _; fi
  fi

  say "Verificando $DOMAIN en Resend"
  rs POST "/domains/$did/verify" >/dev/null || true
  t0=$(date +%s) st=""
  while :; do
    st=$(rs GET "/domains/$did" | jq -r '.status') || st="?"
    [ "$st" = verified ] && break
    if [ $(( $(date +%s) - t0 )) -ge "$VERIFY_WAIT" ]; then break; fi
    printf '\r\033[K  estado: %s · %ss' "$st" $(( $(date +%s) - t0 ))
    sleep "$POLL"
  done
  printf '\r\033[K'
  if [ "$st" = verified ]; then ok "$DOMAIN verificado"
  else warn "$DOMAIN sigue «$st»: los DNS pueden tardar. Queda configurado y se ve en el panel (Correo → Comprobar otra vez)."; fi

  set_env "$ENV" CP_MAIL_PROVIDER resend
  set_env "$ENV" CP_RESEND_API_KEY "$KEY"
  set_env "$ENV" CP_RESEND_DOMAIN_ID "$did"
  set_env "$ENV" CP_MAIL_FROM "CloudPlay <$FROM>"
  [ "$st" = verified ]
}

setup_smtp() {
  [ -n "$SMTP_HOST" ] || ask SMTP_HOST "Servidor SMTP (p. ej. smtp-relay.brevo.com, smtp.gmail.com)"
  if [ -z "$SMTP_PORT" ]; then if [ -t 0 ] && [ "$YES" = 0 ]; then read -r -p "  Puerto [587]: " SMTP_PORT; fi; SMTP_PORT="${SMTP_PORT:-587}"; fi
  if [ -z "$SMTP_SECURITY" ]; then case "$SMTP_PORT" in 465) SMTP_SECURITY=ssl ;; 25) SMTP_SECURITY=none ;; *) SMTP_SECURITY=starttls ;; esac; fi
  [ -n "$SMTP_USER" ] || ask SMTP_USER "Usuario SMTP"
  [ -n "$SMTP_PASSWORD" ] || ask SMTP_PASSWORD "Contraseña SMTP (en Gmail, una contraseña de aplicación)" secret
  [ -n "$FROM" ] || ask FROM "Remitente (p. ej. no-reply@tudominio.com)"
  [[ "$FROM" == *@*.* ]] || die "Remitente no válido: $FROM"
  set_env "$ENV" CP_MAIL_PROVIDER smtp
  set_env "$ENV" CP_SMTP_HOST "$SMTP_HOST"
  set_env "$ENV" CP_SMTP_PORT "$SMTP_PORT"
  set_env "$ENV" CP_SMTP_USER "$SMTP_USER"
  set_env "$ENV" CP_SMTP_PASSWORD "$SMTP_PASSWORD"
  set_env "$ENV" CP_SMTP_SECURITY "$SMTP_SECURITY"
  set_env "$ENV" CP_MAIL_FROM "CloudPlay <$FROM>"
  ok "SMTP $SMTP_HOST:$SMTP_PORT ($SMTP_SECURITY)"
  warn "Recuerda: el SPF/DKIM de ${FROM#*@} los pone tu proveedor SMTP (si no, el correo puede ir a spam)."
}

cmd_setup() {
  [ "$(id -u)" -eq 0 ] || [ -n "${CLOUDPLAY_TEST:-}" ] || die "Ejecútalo con sudo"
  if [ -z "$PROVIDER" ]; then
    if [ -t 0 ] && [ "$YES" = 0 ]; then
      echo
      echo "  1) Resend (recomendado): dominio, DNS y verificación automáticos · 3.000 correos/mes gratis"
      echo "  2) SMTP: Gmail, Brevo, Amazon SES, Mailgun o el servidor de tu empresa"
      read -r -p "  Elige [1]: " v
      case "${v:-1}" in 2) PROVIDER=smtp ;; *) PROVIDER=resend ;; esac
    else
      PROVIDER=resend
    fi
  fi
  local verified=1
  case "$PROVIDER" in
    resend) setup_resend || verified=0 ;;
    smtp) setup_smtp ;;
    *) die "Proveedor desconocido: $PROVIDER (resend o smtp)" ;;
  esac
  chmod 600 "$ENV"
  say "Aplicando (la API se reinicia de una réplica en otra, sin cortes)"
  restart_api
  ok "Correo configurado"
  if [ "$verified" = 1 ]; then send_test || true
  else echo "    Cuando el dominio esté verificado: sudo cloudplay mail test"; fi
  echo "    Qué correos salen y a quién avisar: panel → Correo"
}

cmd_status() {
  local p
  p=$(get_env "$ENV" CP_MAIL_PROVIDER)
  if [ -z "$p" ]; then warn "Sin correo. Para montarlo: sudo cloudplay mail setup"; return 0; fi
  ok "Proveedor: $p · remitente: $(get_env "$ENV" CP_MAIL_FROM)"
  cp_api GET /api/admin/mail | jq -r '
    (if .domain then "Dominio \(.domain.name // "?"): \(.domain.status // .domain.error)" else empty end),
    "Avisos del NOC a: \(.recipients | join(", "))",
    "Últimos envíos:", (.log[:8][] | "  \(.at[0:16]) \(.kind) → \(.to): \(.status)\(if .error then " (\(.error))" else "" end)")' 2>/dev/null || true
}

cmd_off() {
  [ "$(id -u)" -eq 0 ] || [ -n "${CLOUDPLAY_TEST:-}" ] || die "Ejecútalo con sudo"
  set_env "$ENV" CP_MAIL_PROVIDER ""
  restart_api
  ok "Correo apagado (la configuración queda guardada; para volver: sudo cloudplay mail setup)"
}

case "$CMD" in
  setup) cmd_setup ;;
  status) cmd_status ;;
  test) send_test "$TEST_TO" ;;
  off) cmd_off ;;
  *) die "Uso: cloudplay mail setup|status|test [correo]|off" ;;
esac
