#!/usr/bin/env bash
# Instalador de CloudPlay para Ubuntu Server 22.04 / 24.04.
#
#   Orquestador (API, base de datos, web):
#     sudo ./install.sh --role orchestrator --domain play.empresa.com [--tunnel-token TOKEN]
#   Nodo gaming (GPU + emuladores):
#     sudo ./install.sh --role node --cp-url https://play.empresa.com --join-token TOKEN
#   Todo en una máquina:
#     sudo ./install.sh --role all --domain play.empresa.com
#
# Es idempotente: se puede volver a lanzar con los mismos argumentos (no cambia secretos ya generados).
# Lo usan también la ISO (primer arranque), las plantillas de Proxmox y el instalador de nodos del orquestador.
set -Eeuo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST=/opt/cloudplay
ETC=/etc/cloudplay
LOG=/var/log/cloudplay-install.log

ROLE="" DOMAIN="" LANDING_DOMAIN="" TUNNEL_TOKEN="" CF_TURN_KEY_ID="" CF_TURN_TOKEN=""
ADMIN_EMAIL="" ADMIN_PASSWORD="" CP_URL="" JOIN_TOKEN="" NODE_NAME="" CAPACITY="auto"
PLATFORMS="ps2,gc,wii" GPU="auto" LIBRARY_DIR=/srv/cloudplay/library BIOS_DIR=/srv/cloudplay/bios
FIREWALL=1 WITH_LANDING=0 REBOOT_OK=0 SKIP_BUILD=0 DIRECT_PORTS=yes
TAG="${CLOUDPLAY_TAG:-local}"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Opciones del orquestador:
  --domain DOMINIO            dominio de la plataforma (play.empresa.com)
  --landing-domain DOMINIO    dominio de la web comercial (opcional)
  --tunnel-token TOKEN        publica todo con Cloudflare Tunnel (sin abrir puertos)
  --cf-turn-key-id ID         TURN de Cloudflare para el vídeo (recomendado con túnel)
  --cf-turn-token TOKEN
  --admin-email / --admin-password
  --with-landing              compila también la web comercial (usa un contenedor de Node)
Opciones del nodo:
  --cp-url URL                URL del orquestador (https://play.empresa.com)
  --join-token TOKEN          token de unión (cloudplay join-token en el orquestador)
  --name NOMBRE               nombre del nodo (por defecto, el hostname)
  --capacity N|auto           partidas simultáneas
  --platforms ps2,gc,wii
  --gpu auto|nvidia|vaapi|cpu
  --direct-ports yes|no       abrir el rango UDP de WebRTC (no hace falta con el TURN de Cloudflare)
Comunes:
  --no-firewall               no tocar ufw
  --reboot-ok                 reiniciar solo si hace falta (driver NVIDIA) y seguir después
  --skip-build                no compilar imágenes (si ya están o vienen de un registro)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --role) ROLE="$2"; shift ;;
    --domain) DOMAIN="$2"; shift ;;
    --landing-domain) LANDING_DOMAIN="$2"; shift ;;
    --tunnel-token) TUNNEL_TOKEN="$2"; shift ;;
    --cf-turn-key-id) CF_TURN_KEY_ID="$2"; shift ;;
    --cf-turn-token) CF_TURN_TOKEN="$2"; shift ;;
    --admin-email) ADMIN_EMAIL="$2"; shift ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift ;;
    --cp-url) CP_URL="${2%/}"; shift ;;
    --join-token) JOIN_TOKEN="$2"; shift ;;
    --name) NODE_NAME="$2"; shift ;;
    --capacity) CAPACITY="$2"; shift ;;
    --platforms) PLATFORMS="$2"; shift ;;
    --gpu) GPU="$2"; shift ;;
    --library) LIBRARY_DIR="$2"; shift ;;
    --bios) BIOS_DIR="$2"; shift ;;
    --direct-ports) DIRECT_PORTS="$2"; shift ;;
    --no-firewall) FIREWALL=0 ;;
    --with-landing) WITH_LANDING=1 ;;
    --reboot-ok) REBOOT_OK=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

# ------------------------------------------------------------------ utilidades
say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }

rand() { openssl rand -base64 64 | tr -d '/+=\n' | cut -c1-"${1:-40}"; }
# Escribe KEY=VALUE en un fichero .env (sustituye si ya existe)
set_env() {
  local file="$1" key="$2" val="$3" tmp
  touch "$file"
  tmp=$(mktemp)
  awk -v k="$key" -v v="$val" 'BEGIN{done=0} index($0, k"=")==1 {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}
get_env() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- || true; }
# Solo genera el secreto si aún no existe o sigue con el valor de ejemplo
ensure_secret() {
  local cur
  cur=$(get_env "$1" "$2")
  if [ -z "$cur" ] || [[ "$cur" == CAMBIA_ESTO* ]]; then set_env "$1" "$2" "$(rand "${3:-40}")"; fi
}
lan_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }

[ "$(id -u)" -eq 0 ] || die "Ejecútalo como root (sudo)."
case "$ROLE" in orchestrator|node|all) ;; *) usage; die "Indica --role orchestrator, node o all" ;; esac
exec > >(tee -a "$LOG") 2>&1
trap 'die "Falló en la línea $LINENO. Registro completo: $LOG"' ERR
say "CloudPlay · instalando rol «$ROLE» ($(date -Is))"

if [ -r /etc/os-release ]; then . /etc/os-release; fi
[ "${ID:-}" = ubuntu ] || warn "Probado en Ubuntu 22.04/24.04; en ${PRETTY_NAME:-este sistema} puede necesitar ajustes."

mkdir -p "$ETC"
echo "$ROLE" > "$ETC/role"

# ------------------------------------------------------------------ paquetes base
say "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg jq rsync openssl ufw pciutils kmod >/dev/null

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Docker Engine + Compose (repositorio oficial de Docker)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME:-noble} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
# Registros de Docker acotados: un disco lleno es la forma más tonta de tirar un servidor
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  echo '{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"3"}}' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || true
fi
systemctl enable --now docker >/dev/null 2>&1 || true
ok "Docker $(docker version --format '{{.Server.Version}}')"

# ------------------------------------------------------------------ código
say "Copiando CloudPlay a $DEST"
mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  rsync -a --delete \
    --exclude '.git' --exclude '/.env' --exclude '/dist/' --exclude '/worker/worker.env' --exclude '/worker/.env' \
    --exclude '/landing/node_modules' --exclude '/landing/.next' --exclude '/landing/out' \
    --exclude '__pycache__' --exclude '/control-plane/*.db' --exclude '/tests/e2e/*.png' --exclude '/tests/e2e/*.log' \
    "$SRC/" "$DEST/"
fi
install -m 0755 "$DEST/deploy/install/cloudplay" /usr/local/bin/cloudplay
install -m 0755 "$DEST/deploy/install/ups/cloudplay-ups" /usr/local/bin/cloudplay-ups

# Animación de arranque con la marca y el rol de la máquina (master / slave)
say "Marca de arranque"
bash "$DEST/deploy/branding/apply.sh" "$ROLE" "${DOMAIN:-$(echo "$CP_URL" | sed 's#^[a-z]*://##')}" \
  || warn "No se pudo aplicar la animación de arranque (no afecta a CloudPlay)"

# Cómo se instaló (sin secretos: esos quedan en .env / worker.env). Lo reutilizan `cloudplay update`
# y la continuación tras reiniciar por el driver de la GPU.
{
  printf '%q %q ' --role "$ROLE"
  for kv in "--domain=$DOMAIN" "--landing-domain=$LANDING_DOMAIN" "--cp-url=$CP_URL" "--name=$NODE_NAME" \
            "--capacity=$CAPACITY" "--platforms=$PLATFORMS" "--gpu=$GPU" "--library=$LIBRARY_DIR" "--bios=$BIOS_DIR" \
            "--direct-ports=$DIRECT_PORTS"; do
    k="${kv%%=*}"; v="${kv#*=}"
    if [ -n "$v" ]; then printf '%q %q ' "$k" "$v"; fi
  done
  if [ "$FIREWALL" = 0 ]; then printf -- '--no-firewall '; fi
  if [ "$WITH_LANDING" = 1 ]; then printf -- '--with-landing '; fi
} > "$ETC/install.args"
chmod 600 "$ETC/install.args"

# ------------------------------------------------------------------ systemd
unit() {  # nombre, directorio, descripción
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$3
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$2
# Tras un apagón Docker ya rearranca los contenedores (restart: always); esto lo garantiza aunque cambie la config
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=900

[Install]
WantedBy=multi-user.target
EOF
}

# ================================================================== ORQUESTADOR
install_orchestrator() {
  [ -n "$DOMAIN" ] || die "Falta --domain (p. ej. play.empresa.com)"
  local env="$DEST/.env" tunnel=0 profiles="" landing
  [ -f "$env" ] || cp "$DEST/.env.example" "$env"
  chmod 600 "$env"
  if [ -n "$TUNNEL_TOKEN" ]; then set_env "$env" TUNNEL_TOKEN "$TUNNEL_TOKEN"; fi
  if [ -n "$(get_env "$env" TUNNEL_TOKEN)" ]; then tunnel=1; fi

  set_env "$env" CP_DOMAIN "$DOMAIN"
  landing="${LANDING_DOMAIN:-$(get_env "$env" LANDING_DOMAIN)}"
  if [ -z "$landing" ] || [ "$landing" = www.example.com ]; then landing="www.${DOMAIN#*.}"; fi
  set_env "$env" LANDING_DOMAIN "$landing"
  for k in CP_JWT_SECRET TURN_SECRET POSTGRES_PASSWORD CP_JOIN_TOKEN S3_SECRET_KEY; do ensure_secret "$env" "$k"; done
  if [ -n "$ADMIN_EMAIL" ]; then set_env "$env" CP_ADMIN_EMAIL "$ADMIN_EMAIL"; fi
  if [ "$(get_env "$env" CP_ADMIN_EMAIL)" = admin@example.com ]; then set_env "$env" CP_ADMIN_EMAIL "admin@${DOMAIN#*.}"; fi
  if [ -n "$ADMIN_PASSWORD" ]; then set_env "$env" CP_ADMIN_PASSWORD "$ADMIN_PASSWORD"; else ensure_secret "$env" CP_ADMIN_PASSWORD 16; fi
  if [ -n "$CF_TURN_KEY_ID" ]; then set_env "$env" CP_CF_TURN_KEY_ID "$CF_TURN_KEY_ID"; fi
  if [ -n "$CF_TURN_TOKEN" ]; then set_env "$env" CP_CF_TURN_API_TOKEN "$CF_TURN_TOKEN"; fi

  if [ "$tunnel" = 1 ]; then
    # Cloudflare pone el TLS y llega a Caddy por HTTP; nada escucha hacia Internet
    set_env "$env" CP_SITE "http://$DOMAIN"
    set_env "$env" LANDING_SITE "http://$landing"
    set_env "$env" S3_BIND 127.0.0.1
    profiles="tunnel"
    if [ -n "$(get_env "$env" CP_CF_TURN_KEY_ID)" ]; then
      set_env "$env" CP_TURN_PROVIDER cloudflare
    else
      set_env "$env" CP_TURN_PROVIDER none
      warn "Túnel sin TURN de Cloudflare: el vídeo solo llega si los nodos tienen el rango UDP de WebRTC accesible."
      warn "Recomendado: cloudplay turn-cloudflare <KEY_ID> <API_TOKEN>"
    fi
    set_env "$env" CP_NODE_S3_ENDPOINT "https://s3.$DOMAIN"
  else
    set_env "$env" CP_SITE ""
    set_env "$env" LANDING_SITE ""
    set_env "$env" PUBLIC_IP "$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || lan_ip)"
    set_env "$env" S3_BIND "$(lan_ip)"
    if [ -n "$(get_env "$env" CP_CF_TURN_KEY_ID)" ]; then
      set_env "$env" CP_TURN_PROVIDER cloudflare
    else
      set_env "$env" CP_TURN_PROVIDER coturn
      profiles="coturn"
    fi
    set_env "$env" CP_NODE_S3_ENDPOINT "http://$(lan_ip):8333"
  fi
  set_env "$env" COMPOSE_PROFILES "$profiles"
  set_env "$env" CLOUDPLAY_TAG "$TAG"
  # Los nodos reciben el S3 al darse de alta: no va en el instalador público
  set_env "$env" CP_NODE_S3_ACCESS_KEY "$(get_env "$env" S3_ACCESS_KEY)"
  set_env "$env" CP_NODE_S3_SECRET_KEY "$(get_env "$env" S3_SECRET_KEY)"

  if [ "$WITH_LANDING" = 1 ]; then
    say "Compilando la web comercial"
    docker run --rm -v "$DEST/landing:/app" -w /app -e NEXT_PUBLIC_SITE_URL="https://$landing" \
      node:22-bookworm-slim sh -c "npm ci --no-audit --no-fund && npm run build" >/dev/null
  fi
  mkdir -p "$DEST/landing/out"

  cloudplay_dist "$DOMAIN"

  if [ "$FIREWALL" = 1 ]; then
    say "Cortafuegos"
    ufw allow 22/tcp >/dev/null
    if [ "$tunnel" = 0 ]; then
      ufw allow 80/tcp >/dev/null
      ufw allow 443 >/dev/null
      if [ "$profiles" = coturn ]; then
        ufw allow 3478 >/dev/null
        ufw allow 5349/tcp >/dev/null
        ufw allow 49160:49400/udp >/dev/null
      fi
      ufw allow from "$(lan_ip | cut -d. -f1-3).0/24" to any port 8333 proto tcp >/dev/null
    fi
    ufw --force enable >/dev/null
  fi

  say "Construyendo y arrancando el orquestador"
  cd "$DEST"
  if [ "$SKIP_BUILD" = 0 ]; then docker compose build -q; fi
  unit cloudplay "$DEST" "CloudPlay orquestador"
  systemctl daemon-reload
  systemctl enable cloudplay >/dev/null 2>&1 || true
  docker compose up -d --quiet-pull --remove-orphans
  local ready=0
  for _ in $(seq 1 90); do
    if docker compose exec -T api-a python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/ready',timeout=2)" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 2
  done
  if [ "$ready" = 1 ]; then ok "Orquestador en marcha"; else warn "La API tarda en arrancar; mira: cloudplay logs api-a"; fi
  install_backup_timer
  summary_orchestrator
}

# Paquete que el orquestador sirve en /install/: así un nodo se instala con una sola línea
cloudplay_dist() {
  local domain="$1" dist="$DEST/dist"
  mkdir -p "$dist"
  chmod 755 "$dist"
  tar -C "$DEST" --exclude='./.env' --exclude='./dist' --exclude='./landing/node_modules' --exclude='./landing/.next' \
      --exclude='./landing/out' --exclude='./worker/worker.env' --exclude='./worker/.env' --exclude='*/__pycache__' \
      -czf "$dist/cloudplay.tar.gz.tmp" .
  mv "$dist/cloudplay.tar.gz.tmp" "$dist/cloudplay.tar.gz"
  cat > "$dist/node.sh" <<EOF
#!/usr/bin/env bash
# Instala un nodo gaming de CloudPlay y lo une a https://$domain
#   curl -fsSL https://$domain/install/node.sh | sudo bash -s -- --join-token TOKEN [--gpu nvidia] [--capacity 4]
set -euo pipefail
[ "\$(id -u)" -eq 0 ] || { echo "Ejecútalo con sudo"; exit 1; }
TMP=\$(mktemp -d)
curl -fsSL "https://$domain/install/cloudplay.tar.gz" | tar -xz -C "\$TMP"
exec bash "\$TMP/deploy/install/install.sh" --role node --cp-url "https://$domain" "\$@"
EOF
  chmod 644 "$dist/node.sh" "$dist/cloudplay.tar.gz"
}

install_backup_timer() {
  cat > /etc/systemd/system/cloudplay-backup.service <<'EOF'
[Unit]
Description=Copia de seguridad de CloudPlay (base de datos y partidas guardadas)
After=cloudplay.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/cloudplay backup
EOF
  cat > /etc/systemd/system/cloudplay-backup.timer <<'EOF'
[Unit]
Description=Copia diaria de CloudPlay

[Timer]
OnCalendar=*-*-* 04:20
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now cloudplay-backup.timer >/dev/null 2>&1 || true
}

summary_orchestrator() {
  local env="$DEST/.env" f=/root/cloudplay-credenciales.txt d l
  d=$(get_env "$env" CP_DOMAIN)
  l=$(get_env "$env" LANDING_DOMAIN)
  (
    umask 077
    cat > "$f" <<EOF
CloudPlay · orquestador
=======================
Plataforma:      https://$d
Panel:           https://$d/#/admin
Administrador:   $(get_env "$env" CP_ADMIN_EMAIL)
Contraseña:      $(get_env "$env" CP_ADMIN_PASSWORD)

Añadir un nodo gaming (en la máquina con GPU):
  curl -fsSL https://$d/install/node.sh | sudo bash -s -- --join-token $(get_env "$env" CP_JOIN_TOKEN)

Token de unión de nodos: $(get_env "$env" CP_JOIN_TOKEN)
EOF
  )
  echo
  cat "$f"
  echo
  ok "Guardado en $f (solo root)"
  if [ -n "$(get_env "$env" TUNNEL_TOKEN)" ]; then
    say "En Cloudflare (Zero Trust → Networks → Tunnels → tu túnel → Public hostnames) añade:"
    echo "    $d  →  http://caddy:80"
    echo "    $l  →  http://caddy:80     (web comercial, opcional)"
    echo "    s3.$d  →  http://s3:8333   (partidas guardadas de nodos que estén en otra red)"
  fi
}

# ================================================================== NODO GAMING
detect_gpu() {
  if [ "$GPU" != auto ]; then echo "$GPU"; return; fi
  if lspci 2>/dev/null | grep -Eqi '(vga|3d|display).*nvidia'; then echo nvidia
  elif ls /dev/dri/renderD* >/dev/null 2>&1; then echo vaapi
  else echo cpu; fi
}

need_reboot() {
  if [ "$REBOOT_OK" = 1 ]; then
    # Continuación automática tras reiniciar con los mismos argumentos (los secretos ya están en disco)
    cat > /etc/systemd/system/cloudplay-continue.service <<EOF
[Unit]
Description=CloudPlay: continuar la instalación tras reiniciar
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $DEST/deploy/install/continue.sh

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable cloudplay-continue >/dev/null 2>&1
    warn "Hace falta reiniciar para cargar el driver de la GPU. Reiniciando; la instalación sigue sola."
    sleep 3
    systemctl reboot
    exit 0
  fi
  die "Driver de NVIDIA instalado: reinicia y vuelve a lanzar el mismo comando (o usa --reboot-ok)."
}

install_node() {
  local wenv="$DEST/worker/worker.env" gpu cores cap base per
  if [ -f "$wenv" ]; then
    if [ -z "$CP_URL" ]; then CP_URL=$(get_env "$wenv" CP_URL | sed 's#^wss://#https://#; s#^ws://#http://#'); fi
    if [ -z "$JOIN_TOKEN" ]; then JOIN_TOKEN=$(get_env "$wenv" JOIN_TOKEN); fi
  fi
  if [ "$ROLE" = all ]; then
    CP_URL="https://$DOMAIN"
    JOIN_TOKEN=$(get_env "$DEST/.env" CP_JOIN_TOKEN)
  fi
  [ -n "$CP_URL" ] || die "Falta --cp-url (https://play.empresa.com)"
  [ -n "$JOIN_TOKEN" ] || die "Falta --join-token (en el orquestador: cloudplay join-token)"
  # Se guardan ya: si hay que reiniciar por el driver, la continuación los encuentra aquí
  [ -f "$wenv" ] || cp "$DEST/worker/worker.env.example" "$wenv"
  chmod 600 "$wenv"
  set_env "$wenv" CP_URL "$(echo "$CP_URL" | sed 's#^https://#wss://#; s#^http://#ws://#')"
  set_env "$wenv" JOIN_TOKEN "$JOIN_TOKEN"

  gpu=$(detect_gpu)
  say "GPU: $gpu"
  if [ "$gpu" = nvidia ]; then
    if ! command -v nvidia-smi >/dev/null || ! nvidia-smi >/dev/null 2>&1; then
      say "Instalando el driver de NVIDIA (ubuntu-drivers)"
      apt-get install -y -qq ubuntu-drivers-common >/dev/null
      ubuntu-drivers install >/dev/null
      need_reboot
    fi
    if ! command -v nvidia-ctk >/dev/null; then
      say "NVIDIA Container Toolkit"
      curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
      curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
        | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' \
        > /etc/apt/sources.list.d/nvidia-container-toolkit.list
      apt-get update -qq
      apt-get install -y -qq nvidia-container-toolkit >/dev/null
      nvidia-ctk runtime configure --runtime=docker >/dev/null
      systemctl restart docker
    fi
  elif [ "$gpu" = vaapi ]; then
    apt-get install -y -qq mesa-va-drivers vainfo >/dev/null
    apt-get install -y -qq intel-media-va-driver-non-free >/dev/null 2>&1 || true
  fi

  # Mando virtual de cada jugador
  modprobe uinput 2>/dev/null || warn "No se pudo cargar uinput (¿contenedor sin privilegios?)"
  echo uinput > /etc/modules-load.d/cloudplay.conf

  cores=$(nproc)
  if [ "$CAPACITY" = auto ]; then
    cap=$(( cores / 4 ))
    if [ "$cap" -lt 1 ]; then cap=1; fi
    if [ "$cap" -gt 8 ]; then cap=8; fi
    if [ "$gpu" = cpu ]; then cap=1; fi
  else
    cap="$CAPACITY"
  fi

  mkdir -p "$LIBRARY_DIR"/{ps2,gc,wii} "$BIOS_DIR" /var/lib/cloudplay
  set_env "$wenv" NODE_TOKEN ""
  set_env "$wenv" NODE_NAME "${NODE_NAME:-$(hostname -s)}"
  set_env "$wenv" CAPACITY "$cap"
  set_env "$wenv" PLATFORMS "$PLATFORMS"
  set_env "$wenv" GPU "$gpu"
  if [ "$gpu" = vaapi ]; then set_env "$wenv" DRI_NODES "$(ls /dev/dri/renderD* | paste -sd, -)"; fi
  set_env "$wenv" LIBRARY_DIR "$LIBRARY_DIR"
  set_env "$wenv" BIOS_DIR "$BIOS_DIR"
  set_env "$wenv" DATA_DIR /var/lib/cloudplay
  set_env "$wenv" SESSION_IMAGE "cloudplay/session:$TAG"
  set_env "$wenv" SESSION_CPUS "$(( cores / cap > 2 ? cores / cap : 2 ))"
  if [ "$ROLE" = all ]; then
    # Misma máquina: el agente entra por la red interna de Docker (alias "api" = las dos réplicas) y usa el S3 directo
    set_env "$wenv" CP_URL "ws://api:8000"
    set_env "$wenv" S3_ENDPOINT "http://s3:8333"
    set_env "$wenv" S3_ACCESS_KEY "$(get_env "$DEST/.env" S3_ACCESS_KEY)"
    set_env "$wenv" S3_SECRET_KEY "$(get_env "$DEST/.env" S3_SECRET_KEY)"
  fi
  # Variables que Compose interpola en worker/docker-compose.yml (rutas del host)
  {
    echo "LIBRARY_DIR=$LIBRARY_DIR"
    echo "DATA_DIR=/var/lib/cloudplay"
    echo "CLOUDPLAY_TAG=$TAG"
    if [ "$ROLE" = all ]; then echo "COMPOSE_FILE=docker-compose.yml:docker-compose.all.yml"; fi
  } > "$DEST/worker/.env"

  if [ "$FIREWALL" = 1 ]; then
    ufw allow 22/tcp >/dev/null
    # Con el TURN de Cloudflare no hace falta (--direct-ports no); abierto permite conexión directa, más rápida en LAN
    if [ "$DIRECT_PORTS" != no ]; then
      base=$(get_env "$wenv" ICE_PORT_BASE); per=$(get_env "$wenv" ICE_PORTS_PER_SLOT)
      ufw allow "${base:-40000}:$(( ${base:-40000} + ${per:-20} * cap - 1 ))/udp" >/dev/null
    fi
    ufw --force enable >/dev/null
  fi

  cd "$DEST/worker"
  if [ "$SKIP_BUILD" = 0 ]; then
    say "Construyendo la imagen de sesión (emuladores + GStreamer). La primera vez tarda un rato."
    docker build -q -t "cloudplay/session:$TAG" session >/dev/null
    docker compose build -q
  fi
  unit cloudplay-node "$DEST/worker" "CloudPlay nodo gaming"
  systemctl daemon-reload
  systemctl enable cloudplay-node >/dev/null 2>&1 || true
  docker compose up -d --quiet-pull --remove-orphans
  local connected=0
  for _ in $(seq 1 60); do
    if jq -e '.connected == true' /var/lib/cloudplay/status.json >/dev/null 2>&1; then connected=1; break; fi
    sleep 2
  done
  if [ "$connected" = 1 ]; then
    ok "Nodo «$(get_env "$wenv" NODE_NAME)» conectado a $CP_URL con $cap huecos ($gpu)"
  else
    warn "El nodo aún no conecta. Mira: cloudplay logs"
  fi
  echo "  Copia tus juegos en $LIBRARY_DIR/{ps2,gc,wii} y las BIOS de PS2 en $BIOS_DIR."
}

case "$ROLE" in
  orchestrator) install_orchestrator ;;
  node) install_node ;;
  all) install_orchestrator; install_node ;;
esac
ok "Listo. Comandos útiles: cloudplay status · cloudplay logs · cloudplay update"
