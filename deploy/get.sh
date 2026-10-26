#!/usr/bin/env bash
# CloudPlay · instalador universal desde GitHub (código en Releases, imágenes ya compiladas en GHCR).
#
#   curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | sudo bash -s -- <modo> [opciones]
#
# Modos:
#   orchestrator  --domain play.empresa.com [--tunnel-token T --cf-turn-key-id K --cf-turn-token A]
#   node          --cp-url https://play.empresa.com --join-token TOKEN
#   all           --domain play.empresa.com                  (orquestador + nodo en la misma máquina)
#   proxmox       node-template|scale|retire|orchestrator-vm ...  (en el host de Proxmox)
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
DIR="${CLOUDPLAY_DIR:-/opt/cloudplay-src}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

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
