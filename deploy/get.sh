#!/usr/bin/env bash
# CloudPlay · instalador universal desde GitHub (código en Releases, imágenes ya compiladas en GHCR).
#
#   curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | sudo bash -s -- <modo> [opciones]
#
# Modos:
#   orchestrator  --domain play.empresa.com [--tunnel-token T --cf-turn-key-id K --cf-turn-token A]
#   node          --cp-url https://play.empresa.com --join-token TOKEN
#   all           --domain play.empresa.com                  (orquestador + nodo en la misma máquina)
#   proxmox       cluster --nodes N | cluster-add N | node-template | scale | retire | orchestrator-vm ...
#                 (en el shell del host de Proxmox; baja la imagen ghcr.io/…/cloudplay-pve, sin Docker)
#   iso           --role orchestrator|node ...               (crea la ISO autoinstalable)
#   helm          --domain play.empresa.com [--tunnel-token T] [--set clave=valor ...]  (Kubernetes)
#
# Variables: CLOUDPLAY_VERSION=v1.2.0 (por defecto la última), CLOUDPLAY_DIR (dónde dejar el código).
set -Eeuo pipefail

REPO="${CLOUDPLAY_REPO:-fieropirata275/cloudplay}"
VERSION="${CLOUDPLAY_VERSION:-latest}"
OWNER="$(echo "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')"
IMAGES="${CLOUDPLAY_IMAGES:-ghcr.io/$OWNER/cloudplay-}"

say() { printf '\033[1;35m▸\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }

MODE="${1:-}"
[ -n "$MODE" ] || { sed -n '2,16p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' >&2 || true; die "Indica un modo: orchestrator, node, all, proxmox, iso o helm"; }
shift
case "$MODE" in orchestrator|node|all|proxmox|iso|helm) ;; *) die "Modo desconocido: $MODE (orchestrator, node, all, proxmox, iso o helm)" ;; esac

if [ "$VERSION" = latest ]; then BASE="https://github.com/$REPO/releases/latest/download"
else BASE="https://github.com/$REPO/releases/download/$VERSION"; fi
BASE="${CLOUDPLAY_RELEASE_BASE:-$BASE}"

for t in curl tar sha256sum; do command -v "$t" >/dev/null || die "Falta $t"; done

# ------------------------------------------------------------------ Proxmox: la imagen cloudplay-pve de GHCR
# Proxmox no trae Docker (ni conviene instalarlo en el host): se descargan las capas de la imagen con la API del
# registro, se comprueba el SHA256 de cada una y se ejecuta su script aquí mismo, donde están qm y pvesh.
json() { perl -MJSON::PP -0777 -ne "\$j = decode_json(\$_); $1"; }
pve_from_ghcr() {  # destino
  local repo="$OWNER/cloudplay-pve" tag="$VERSION" tok man acc d n=0
  acc="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json"
  acc="$acc,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"
  command -v perl >/dev/null || return 1
  tok=$(curl -fsSL "https://ghcr.io/token?scope=repository:$repo:pull" | json 'print $j->{token}') || return 1
  man=$(curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: $acc" "https://ghcr.io/v2/$repo/manifests/$tag") || return 1
  d=$(printf '%s' "$man" | json 'for (@{$j->{manifests} || []}) { if (($_->{platform}{architecture} // "") eq "amd64") { print $_->{digest}; last } }')
  if [ -n "$d" ]; then
    man=$(curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: $acc" "https://ghcr.io/v2/$repo/manifests/$d") || return 1
  fi
  mkdir -p "$1"
  for d in $(printf '%s' "$man" | json 'print join(" ", map { $_->{digest} } @{$j->{layers}})'); do
    curl -fsSL -H "Authorization: Bearer $tok" "https://ghcr.io/v2/$repo/blobs/$d" -o "$TMP/layer" || return 1
    [ "sha256:$(sha256sum "$TMP/layer" | cut -d' ' -f1)" = "$d" ] || die "Una capa de $repo no coincide con su SHA256: no se ejecuta nada"
    tar -xzf "$TMP/layer" -C "$1" cloudplay-pve 2>/dev/null && n=$((n + 1))
  done
  [ "$n" -gt 0 ] && [ -f "$1/cloudplay-pve/cloudplay-pve.sh" ]
}
DIR="${CLOUDPLAY_DIR:-/opt/cloudplay-src}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ "$MODE" = proxmox ]; then
  [ "$(id -u)" -eq 0 ] || die "Ejecútalo como root en el shell del host de Proxmox"
  command -v qm >/dev/null || die "Esto va en el shell del host de Proxmox VE (Nodo → Shell)"
  say "Descargando el despliegue para Proxmox (ghcr.io/$OWNER/cloudplay-pve:$VERSION)"
  if pve_from_ghcr "$TMP/pve"; then
    export CLOUDPLAY_REPO="$REPO"
    say "Versión $(cat "$TMP/pve/cloudplay-pve/VERSION" 2>/dev/null || echo "$VERSION")"
    bash "$TMP/pve/cloudplay-pve/cloudplay-pve.sh" "$@"
    exit $?
  fi
  say "Sin acceso a GHCR: se usa el paquete de la Release"
fi

say "Descargando CloudPlay ($VERSION) de github.com/$REPO"
curl -fsSL "$BASE/cloudplay.tar.gz" -o "$TMP/cloudplay.tar.gz"
curl -fsSL "$BASE/SHA256SUMS" -o "$TMP/SHA256SUMS"
(cd "$TMP" && grep ' cloudplay.tar.gz$' SHA256SUMS | sha256sum -c --quiet -) || die "El paquete no coincide con su SHA256: no se instala nada"

rm -rf "$DIR.new" && mkdir -p "$DIR.new"
tar -xzf "$TMP/cloudplay.tar.gz" -C "$DIR.new"
rm -rf "$DIR" && mv "$DIR.new" "$DIR"
TAG=$(cat "$DIR/VERSION" 2>/dev/null || echo latest)
say "Versión $TAG · imágenes ${IMAGES}*:$TAG"
mkdir -p /etc/cloudplay 2>/dev/null && echo "$REPO" > /etc/cloudplay/release 2>/dev/null || true

case "$MODE" in
  orchestrator|node|all)
    [ "$(id -u)" -eq 0 ] || die "Ejecútalo con sudo"
    exec bash "$DIR/deploy/install/install.sh" --role "$MODE" --images "$IMAGES" --version "$TAG" "$@" ;;
  proxmox)
    export CLOUDPLAY_REPO="$REPO" CLOUDPLAY_VERSION="$TAG"
    exec bash "$DIR/deploy/proxmox/cloudplay-pve.sh" "$@" ;;
  iso)
    exec bash "$DIR/deploy/iso/build-iso.sh" "$@" --images "$IMAGES" --version "$TAG" ;;
  helm)
    command -v helm >/dev/null || die "Falta helm (https://helm.sh/docs/intro/install/)"
    DOMAIN="" TUNNEL="" SETS=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --domain) DOMAIN="$2"; shift ;;
        --tunnel-token) TUNNEL="$2"; shift ;;
        --set) SETS+=(--set "$2"); shift ;;
        *) SETS+=("$1") ;;
      esac
      shift
    done
    [ -n "$DOMAIN" ] || die "Falta --domain"
    [ -n "$TUNNEL" ] && SETS+=(--set "cloudflared.token=$TUNNEL")
    [ -z "$TUNNEL" ] && SETS+=(--set cloudflared.enabled=false)
    exec helm upgrade --install cloudplay "$DIR/deploy/helm/cloudplay" -n cloudplay --create-namespace \
      --set "domain=$DOMAIN" \
      --set "images.controlPlane=${IMAGES}control-plane:$TAG" --set "images.web=${IMAGES}web:$TAG" \
      --set "images.agent=${IMAGES}agent:$TAG" --set "gaming.sessionImage=${IMAGES}session:$TAG" \
      "${SETS[@]}" ;;
  *) die "Modo desconocido: $MODE" ;;
esac
