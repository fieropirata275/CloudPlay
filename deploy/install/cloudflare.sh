#!/usr/bin/env bash
# CloudPlay · publicar el máster en Internet con Cloudflare en un comando (lo llama `sudo cloudplay cloudflare`).
#
#   cloudplay cloudflare [--token T] [--hostname play.tudominio.com] [--landing www.tudominio.com] [--no-turn] [--yes]
#   cloudplay cloudflare status
#   cloudplay cloudflare off [--delete]
#
# Con un token de API de Cloudflare lo crea todo: el túnel (sin abrir puertos ni IP fija), sus rutas, los DNS y una
# clave TURN para que el vídeo llegue desde cualquier red. La red local sigue entrando por la IP del máster.
#
# Token: dash.cloudflare.com → Mi perfil → Tokens de API → Crear token → "Crear token personalizado" con:
#   Cuenta · Cloudflare Tunnel · Editar      Zona · DNS · Editar      Zona · Zona · Leer
#   Cuenta · Calls · Editar   (opcional: TURN del vídeo; si falta, se avisa y sigue)
set -Eeuo pipefail

DEST="${CLOUDPLAY_DEST:-/opt/cloudplay}"
ETC="${CLOUDPLAY_ETC:-/etc/cloudplay}"
ENV="$DEST/.env"
CF_ENV="$ETC/cloudflare.env"
CF_API="${CF_API:-https://api.cloudflare.com/client/v4}"
INSTALL="${CLOUDPLAY_INSTALL:-bash $DEST/deploy/install/install.sh}"
DC="${CLOUDPLAY_DC:-docker compose}"
HEALTH_WAIT="${CLOUDPLAY_HEALTH_WAIT:-180}"

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
lan_ip() {
  local ip
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}')
  echo "${ip:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
}

TOKEN="" HOST="" LANDING="" TURN=1 YES=0 DELETE=0
CMD="setup"
case "${1:-}" in status|off|setup) CMD="$1"; shift ;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift ;;
    --hostname|--domain) HOST="$2"; shift ;;
    --landing) LANDING="$2"; shift ;;
    --no-turn) TURN=0 ;;
    --delete) DELETE=1 ;;
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
  shift
done
command -v jq >/dev/null || die "Falta jq (apt install jq)"

# ------------------------------------------------------------------ API de Cloudflare
# cf MÉTODO RUTA [JSON] → escribe .result; si Cloudflare dice que no, enseña su error y devuelve 1
cf() {
  local out
  out=$(curl -sS -m 30 -X "$1" "$CF_API$2" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        ${3:+--data "$3"}) || { echo "sin conexión con la API de Cloudflare" >&2; return 1; }
  if [ "$(echo "$out" | jq -r '.success // false' 2>/dev/null)" != true ]; then
    echo "$out" | jq -r '[.errors[]? | "\(.code): \(.message)"] | join("; ") | if . == "" then "respuesta inesperada" else . end' >&2 2>/dev/null \
      || echo "respuesta inesperada de Cloudflare" >&2
    return 1
  fi
  echo "$out" | jq -c '.result'
}

load_state() {
  [ -f "$CF_ENV" ] || die "Este máster no está publicado con «cloudplay cloudflare»"
  # shellcheck disable=SC1090
  . "$CF_ENV"
  TOKEN="${TOKEN:-$CF_API_TOKEN}"
}

# Zona de Cloudflare a la que pertenece el nombre: play.bar.com → bar.com (prueba de más largo a más corto)
find_zone() {
  local cand="$1" z
  while [[ "$cand" == *.* ]]; do
    z=$(cf GET "/zones?name=$cand&status=active" | jq -c '.[0] // empty') || return 1
    if [ -n "$z" ]; then echo "$z"; return 0; fi
    cand="${cand#*.}"
  done
  return 1
}

# Antes de crear nada: ¿algún nombre apunta ya a otra cosa? No se pisa sin confirmarlo
check_dns() {  # zona nombre...
  local z="$1" h rec typ content
  shift
  for h in "$@"; do
    rec=$(cf GET "/zones/$z/dns_records?name=$h" | jq -c '.[0] // empty') || die "El token no puede leer los DNS (falta «Zona · DNS · Editar»)"
    [ -n "$rec" ] || continue
    typ=$(echo "$rec" | jq -r '.type') content=$(echo "$rec" | jq -r '.content')
    if [ "$typ" = CNAME ] && [[ "$content" == *.cfargotunnel.com ]]; then continue; fi
    if [ "$YES" = 0 ]; then
      [ -t 0 ] || die "$h ya existe en Cloudflare ($typ → $content). Repite con --yes para sustituirlo"
      read -r -p "  $h ya apunta a $content ($typ). ¿Sustituirlo por el túnel? [s/N] " a
      case "$a" in s|S|si|sí|SI) ;; *) die "Sin cambios: elige otro nombre" ;; esac
    fi
  done
}

# CNAME hacia el túnel (check_dns ya ha confirmado si había que sustituir algo)
upsert_cname() {  # zona nombre destino
  local rec rid typ content body
  body=$(jq -nc --arg n "$2" --arg c "$3" '{type: "CNAME", name: $n, content: $c, proxied: true, comment: "CloudPlay"}')
  rec=$(cf GET "/zones/$1/dns_records?name=$2" | jq -c '.[0] // empty')
  if [ -z "$rec" ]; then
    cf POST "/zones/$1/dns_records" "$body" | jq -r '.id'
    return
  fi
  rid=$(echo "$rec" | jq -r '.id') typ=$(echo "$rec" | jq -r '.type') content=$(echo "$rec" | jq -r '.content')
  if [ "$typ" != CNAME ] || [[ "$content" != *.cfargotunnel.com ]]; then
    if [ "$typ" != CNAME ]; then
      cf DELETE "/zones/$1/dns_records/$rid" >/dev/null
      cf POST "/zones/$1/dns_records" "$body" | jq -r '.id'
      return
    fi
  fi
  cf PUT "/zones/$1/dns_records/$rid" "$body" | jq -r '.id'
}

# Repite la instalación del máster con otros argumentos (lo mismo que hace `cloudplay update`)
# shellcheck disable=SC2120
reinstall() {  # usa EXTRA; quita del install.args lo que se cambia
  local args=() skip=0 a
  eval "set -- $(cat "$ETC/install.args" 2>/dev/null)"
  for a in "$@"; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case "$a" in --domain|--landing-domain|--lan-ip) skip=1; continue ;; esac
    args+=("$a")
  done
  # shellcheck disable=SC2086
  $INSTALL "${args[@]}" "${EXTRA[@]}" --skip-build
}

# ------------------------------------------------------------------ setup
cmd_setup() {
  [ "$(id -u)" -eq 0 ] || [ -n "${CLOUDPLAY_TEST:-}" ] || die "Ejecútalo con sudo"
  [ -f "$ENV" ] || die "Esto va en el máster (orquestador) de CloudPlay"
  if [ -f "$CF_ENV" ]; then
    # shellcheck disable=SC1090
    . "$CF_ENV"
    TOKEN="${TOKEN:-$CF_API_TOKEN}" HOST="${HOST:-$CF_HOSTNAME}" LANDING="${LANDING:-$CF_LANDING}"
  fi
  TOKEN="${TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
  if [ -z "$TOKEN" ]; then
    [ -t 0 ] || die "Falta --token (token de API de Cloudflare)"
    echo
    echo "  Crea un token en dash.cloudflare.com → Mi perfil → Tokens de API → Crear token personalizado:"
    echo "    Cuenta · Cloudflare Tunnel · Editar   ·   Zona · DNS · Editar   ·   Zona · Zona · Leer"
    echo "    Cuenta · Calls · Editar  (para el vídeo desde fuera de tu red; recomendado)"
    echo
    read -r -s -p "  Token de API de Cloudflare: " TOKEN; echo
  fi
  if [ -z "$HOST" ]; then
    [ -t 0 ] || die "Falta --hostname (p. ej. play.tudominio.com)"
    read -r -p "  Nombre para la plataforma (p. ej. play.tudominio.com): " HOST
  fi
  HOST=$(echo "$HOST" | tr '[:upper:]' '[:lower:]' | sed 's#^[a-z]*://##; s#/.*##')
  [[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "Nombre no válido: $HOST"

  say "Comprobando el token y buscando la zona de $HOST"
  local zone zid acc zname tname tun tid ttoken ingress turn_id turn_key s3 dns_ids=() h
  zone=$(find_zone "$HOST") || die "Ninguna zona activa de tu cuenta de Cloudflare contiene $HOST (o el token no tiene «Zona · Leer»)"
  zid=$(echo "$zone" | jq -r '.id') acc=$(echo "$zone" | jq -r '.account.id') zname=$(echo "$zone" | jq -r '.name')
  ok "Zona $zname"
  check_dns "$zid" "$HOST" "s3.$HOST" ${LANDING:+"$LANDING"}

  # Túnel gestionado desde Cloudflare (sus rutas se cambian por API, no hay ficheros en el máster)
  tname="cloudplay-${HOST//./-}"
  tun=$(cf GET "/accounts/$acc/cfd_tunnel?name=$tname&is_deleted=false" | jq -c '.[0] // empty') \
    || die "El token no puede ver los túneles (falta «Cuenta · Cloudflare Tunnel · Editar»)"
  if [ -n "$tun" ]; then
    tid=$(echo "$tun" | jq -r '.id')
    ok "Túnel $tname (ya existía)"
  else
    tid=$(cf POST "/accounts/$acc/cfd_tunnel" "$(jq -nc --arg n "$tname" '{name: $n, config_src: "cloudflare"}')" | jq -r '.id') \
      || die "No se pudo crear el túnel"
    ok "Túnel $tname creado"
  fi
  ttoken=$(cf GET "/accounts/$acc/cfd_tunnel/$tid/token" | jq -r '.') || die "No se pudo leer el token del túnel"

  s3="s3.$HOST"
  ingress=$(jq -nc --arg h "$HOST" --arg s "$s3" --arg l "$LANDING" '{config: {ingress: (
      [{hostname: $h, service: "http://caddy:80"}, {hostname: $s, service: "http://s3:8333"}]
      + (if $l != "" then [{hostname: $l, service: "http://caddy:80"}] else [] end)
      + [{service: "http_status:404"}])}}')
  cf PUT "/accounts/$acc/cfd_tunnel/$tid/configurations" "$ingress" >/dev/null || die "No se pudieron guardar las rutas del túnel"
  ok "Rutas: $HOST → web · $s3 → partidas guardadas${LANDING:+ · $LANDING → web comercial}"

  for h in "$HOST" "$s3" ${LANDING:+"$LANDING"}; do
    dns_ids+=("$(upsert_cname "$zid" "$h" "$tid.cfargotunnel.com")") || die "No se pudo crear el DNS de $h (falta «Zona · DNS · Editar»)"
  done
  ok "DNS en Cloudflare (con proxy): $HOST, $s3${LANDING:+, $LANDING}"

  # TURN de Cloudflare: el vídeo de las partidas llega a jugadores de cualquier red sin abrir puertos UDP
  turn_id="${CF_TURN_UID:-}" turn_key=""
  if [ "$TURN" = 1 ] && [ -z "$turn_id" ]; then
    local tk
    if tk=$(cf POST "/accounts/$acc/calls/turn_keys" "$(jq -nc --arg n "$tname" '{name: $n}')" 2>/dev/null); then
      turn_id=$(echo "$tk" | jq -r '.uid // .key_id // empty') turn_key=$(echo "$tk" | jq -r '.key // empty')
      ok "Clave TURN para el vídeo creada"
    else
      warn "Sin TURN de Cloudflare (el token no tiene «Cuenta · Calls · Editar»): desde fuera de tu red el vídeo puede no llegar."
    fi
  fi

  ( umask 077
    { printf 'CF_API_TOKEN=%q\nCF_ACCOUNT_ID=%q\nCF_ZONE_ID=%q\nCF_TUNNEL_ID=%q\n' "$TOKEN" "$acc" "$zid" "$tid"
      printf 'CF_HOSTNAME=%q\nCF_LANDING=%q\nCF_DNS_IDS=%q\nCF_TURN_UID=%q\n' "$HOST" "$LANDING" "${dns_ids[*]}" "$turn_id"
    } > "$CF_ENV" )

  say "Aplicando en el máster (CloudPlay se reinicia por partes, sin cortar partidas)"
  EXTRA=(--domain "$HOST" --tunnel-token "$ttoken")
  if [ -n "$LANDING" ]; then EXTRA+=(--landing-domain "$LANDING"); fi
  if [ -n "$turn_key" ]; then EXTRA+=(--cf-turn-key-id "$turn_id" --cf-turn-token "$turn_key"); fi
  reinstall

  say "Esperando a que https://$HOST responda (los DNS nuevos tardan un poco)"
  local t0
  t0=$(date +%s)
  until curl -fsS -m 5 "https://$HOST/api/health" >/dev/null 2>&1; do
    if [ $(( $(date +%s) - t0 )) -ge "$HEALTH_WAIT" ]; then
      warn "Aún no responde. Suele ser la caché de DNS: prueba en unos minutos o con «cloudplay cloudflare status»."
      break
    fi
    sleep 5
  done
  echo
  ok "CloudPlay publicado: https://$HOST"
  echo "    En tu red sigue entrando por http://$(lan_ip)"
  echo "    Estado: sudo cloudplay cloudflare status   ·   Quitarlo: sudo cloudplay cloudflare off"
}

# ------------------------------------------------------------------ status
cmd_status() {
  load_state
  local t st conns
  t=$(cf GET "/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID") || die "No se pudo consultar el túnel"
  st=$(echo "$t" | jq -r '.status') conns=$(echo "$t" | jq -r '[.connections[]?] | length')
  case "$st" in
    healthy) ok "Túnel $(echo "$t" | jq -r .name): sano ($conns conexiones con Cloudflare)" ;;
    degraded) warn "Túnel degradado ($conns conexiones): mira «cloudplay logs cloudflared»" ;;
    *) warn "Túnel $st: ¿está arrancado cloudflared? (cloudplay logs cloudflared)" ;;
  esac
  if curl -fsS -m 8 "https://$CF_HOSTNAME/api/health" >/dev/null 2>&1; then ok "https://$CF_HOSTNAME responde"
  else warn "https://$CF_HOSTNAME no responde todavía"; fi
  if [ -n "${CF_TURN_UID:-}" ]; then ok "TURN de Cloudflare para el vídeo"; else warn "Sin TURN de Cloudflare"; fi
}

# ------------------------------------------------------------------ off
cmd_off() {
  [ "$(id -u)" -eq 0 ] || [ -n "${CLOUDPLAY_TEST:-}" ] || die "Ejecútalo con sudo"
  load_state
  if [ "$YES" = 0 ] && [ -t 0 ]; then
    read -r -p "  ¿Dejar de publicar https://$CF_HOSTNAME y volver a solo red local? [s/N] " a
    case "$a" in s|S|si|sí) ;; *) die "Sin cambios" ;; esac
  fi
  say "Volviendo a la red local"
  set_env "$ENV" TUNNEL_TOKEN ""
  set_env "$ENV" CP_TURN_PROVIDER ""
  (cd "$DEST" && $DC rm -sf cloudflared >/dev/null 2>&1) || true
  EXTRA=(--lan-ip "$(lan_ip)")
  reinstall
  if [ "$DELETE" = 1 ]; then
    say "Borrando en Cloudflare lo que creó CloudPlay"
    local id
    for id in $CF_DNS_IDS; do cf DELETE "/zones/$CF_ZONE_ID/dns_records/$id" >/dev/null || warn "DNS $id: no se pudo borrar"; done
    sleep 5  # que el túnel quede sin conexiones
    cf DELETE "/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID" >/dev/null || warn "El túnel no se pudo borrar (bórralo en Zero Trust → Redes → Túneles)"
    if [ -n "${CF_TURN_UID:-}" ]; then cf DELETE "/accounts/$CF_ACCOUNT_ID/calls/turn_keys/$CF_TURN_UID" >/dev/null || true; fi
    rm -f "$CF_ENV"
    ok "Túnel, DNS y clave TURN borrados"
  else
    echo "    El túnel y los DNS siguen en Cloudflare (para volver: sudo cloudplay cloudflare). Borrarlos: off --delete"
  fi
  ok "Solo red local: http://$(lan_ip)"
}

case "$CMD" in
  setup) cmd_setup ;;
  status) cmd_status ;;
  off) cmd_off ;;
esac
