#!/usr/bin/env bash
# CloudPlay en Proxmox VE 8: plantilla de nodo gaming, clones en un comando y retirada sin cortar partidas.
# Se ejecuta en el host de Proxmox como root.
#
#   1) Orquestador: VM que arranca la ISO de CloudPlay (deploy/iso/build-iso.sh --unattended)
#        ./cloudplay-pve.sh orchestrator-vm --iso local:iso/cloudplay-orchestrator.iso
#   2) Plantilla de nodo gaming (Ubuntu 24.04 cloud image + cloud-init que se une solo al orquestador)
#        ./cloudplay-pve.sh node-template --cp-url https://play.empresa.com --join-token TOKEN
#   3) Escalar: N nodos clonados de la plantilla (con GPU en passthrough, una por clon)
#        ./cloudplay-pve.sh scale 3 --gpu-pci 0000:01:00.0,0000:02:00.0,0000:03:00.0
#   4) Retirar un nodo sin cortar a nadie: lo drena, espera a que acaben sus partidas y lo borra
#        ./cloudplay-pve.sh retire 9103 --cp-url https://play.empresa.com --admin-email A --admin-password P
set -Eeuo pipefail

STORAGE=local-lvm SNIPPETS=local BRIDGE=vmbr0 TEMPLATE_ID=9100 CORES=8 MEMORY=16384 DISK=64 PREFIX=cloudplay-node
CP_URL="" JOIN_TOKEN="" GPU=auto GPU_PCI="" ISO="" VMID="" SSH_KEY="" ADMIN_EMAIL="" ADMIN_PASSWORD="" CAPACITY=auto
IMG_URL=https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
IMG_DIR=/var/lib/vz/template/cloudplay

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'

Opciones: --storage local-lvm --snippets local --bridge vmbr0 --template 9100 --vmid N
          --cores 8 --memory 16384 --disk 64 --prefix cloudplay-node --gpu auto|nvidia|vaapi|cpu
          --capacity auto|N --ssh-key ~/.ssh/id_ed25519.pub
EOF
}

CMD="${1:-}"; shift || true
ARG1=""
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then ARG1="$1"; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --storage) STORAGE="$2"; shift ;;
    --snippets) SNIPPETS="$2"; shift ;;
    --bridge) BRIDGE="$2"; shift ;;
    --template) TEMPLATE_ID="$2"; shift ;;
    --vmid) VMID="$2"; shift ;;
    --cores) CORES="$2"; shift ;;
    --memory) MEMORY="$2"; shift ;;
    --disk) DISK="$2"; shift ;;
    --prefix) PREFIX="$2"; shift ;;
    --cp-url) CP_URL="${2%/}"; shift ;;
    --join-token) JOIN_TOKEN="$2"; shift ;;
    --gpu) GPU="$2"; shift ;;
    --gpu-pci) GPU_PCI="$2"; shift ;;
    --capacity) CAPACITY="$2"; shift ;;
    --iso) ISO="$2"; shift ;;
    --ssh-key) SSH_KEY="$2"; shift ;;
    --admin-email) ADMIN_EMAIL="$2"; shift ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
  shift
done

need_pve() { command -v qm >/dev/null && command -v pvesh >/dev/null || die "Esto se ejecuta en un host de Proxmox VE"; }
next_id() { pvesh get /cluster/nextid; }

snippets_path() {
  # Ruta en disco del almacenamiento de snippets (y lo habilita si hace falta)
  local content path
  content=$(pvesm config "$SNIPPETS" 2>/dev/null | awk '/^\s*content/ {print $2}') || true
  [ -n "$content" ] || die "No existe el almacenamiento $SNIPPETS"
  if [[ ",$content," != *,snippets,* ]]; then
    say "Habilitando «snippets» en $SNIPPETS (necesario para cloud-init personalizado)"
    pvesm set "$SNIPPETS" --content "$content,snippets"
  fi
  path=$(pvesm path "$SNIPPETS:snippets/x" | sed 's#/x$##')
  mkdir -p "$path"
  echo "$path"
}

cmd_node_template() {
  need_pve
  [ -n "$CP_URL" ] && [ -n "$JOIN_TOKEN" ] || die "Faltan --cp-url y --join-token (en el orquestador: cloudplay node-command)"
  local id="${VMID:-$TEMPLATE_ID}" snip img
  qm status "$id" >/dev/null 2>&1 && die "Ya existe la VM $id (usa --vmid)"

  say "Imagen cloud de Ubuntu 24.04"
  mkdir -p "$IMG_DIR"
  img="$IMG_DIR/noble-server-cloudimg-amd64.img"
  curl -fsSL "${IMG_URL%/*}/SHA256SUMS" -o "$IMG_DIR/SHA256SUMS"
  if ! (cd "$IMG_DIR" && grep ' \*noble-server-cloudimg-amd64.img$' SHA256SUMS | sha256sum -c --quiet - 2>/dev/null); then
    curl -fL --progress-bar "$IMG_URL" -o "$img"
    (cd "$IMG_DIR" && grep ' \*noble-server-cloudimg-amd64.img$' SHA256SUMS | sha256sum -c --quiet -) || die "Imagen corrupta"
  fi

  snip=$(snippets_path)
  # cloud-init: al primer arranque instala el nodo con el instalador que sirve el orquestador.
  # El nombre del nodo es el de la VM (cada clon tiene el suyo) y se une solo con el token.
  cat > "$snip/cloudplay-node.yaml" <<EOF
#cloud-config
package_update: true
packages: [curl, jq, qemu-guest-agent]
runcmd:
  - systemctl enable --now qemu-guest-agent
  - curl -fsSL $CP_URL/install/node.sh -o /root/cloudplay-node.sh
  - bash /root/cloudplay-node.sh --join-token $JOIN_TOKEN --gpu $GPU --capacity $CAPACITY --reboot-ok > /var/log/cloudplay-firstboot.log 2>&1
EOF
  chmod 600 "$snip/cloudplay-node.yaml"

  say "Creando la plantilla $id"
  qm create "$id" --name "$PREFIX-template" --machine q35 --bios ovmf --cpu host --cores "$CORES" --memory "$MEMORY" \
    --balloon 0 --net0 "virtio,bridge=$BRIDGE" --scsihw virtio-scsi-single --agent enabled=1 --ostype l26 \
    --serial0 socket --vga std --tags cloudplay
  qm set "$id" --efidisk0 "$STORAGE:0,efitype=4m,pre-enrolled-keys=0" >/dev/null
  qm set "$id" --scsi0 "$STORAGE:0,import-from=$img,discard=on,iothread=1,ssd=1" >/dev/null
  qm resize "$id" scsi0 "${DISK}G" >/dev/null
  qm set "$id" --ide2 "$STORAGE:cloudinit" --boot order=scsi0 --ipconfig0 ip=dhcp --ciuser cloudplay \
    --cicustom "vendor=$SNIPPETS:snippets/cloudplay-node.yaml" >/dev/null
  if [ -n "$SSH_KEY" ]; then qm set "$id" --sshkeys "$SSH_KEY" >/dev/null; fi
  # Arranque automático del nodo cuando vuelve la luz al host
  qm set "$id" --onboot 1 >/dev/null
  qm template "$id" >/dev/null
  ok "Plantilla $id lista. Siguiente: $0 scale 2 [--gpu-pci ...]"
}

cmd_scale() {
  need_pve
  local n="${ARG1:-1}" i id name pcis=()
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] || die "Uso: $0 scale N"
  qm config "$TEMPLATE_ID" 2>/dev/null | grep -q '^template: 1' || die "No hay plantilla en $TEMPLATE_ID (node-template primero)"
  IFS=, read -r -a pcis <<< "$GPU_PCI"
  for i in $(seq 1 "$n"); do
    id=$(next_id)
    name="$PREFIX-$id"
    say "Clonando $name ($id)"
    qm clone "$TEMPLATE_ID" "$id" --name "$name" --full 1 >/dev/null
    if [ "${#pcis[@]}" -ge "$i" ] && [ -n "${pcis[$((i-1))]}" ]; then
      qm set "$id" --hostpci0 "${pcis[$((i-1))]},pcie=1" >/dev/null
      echo "  GPU ${pcis[$((i-1))]} en passthrough"
    fi
    qm start "$id"
  done
  ok "$n nodo(s) arrancando. Aparecen solos en el panel en unos minutos (con NVIDIA reinician una vez)."
}

cmd_orchestrator_vm() {
  need_pve
  [ -n "$ISO" ] || die "Falta --iso almacenamiento:iso/cloudplay-orchestrator.iso (súbela antes a Proxmox)"
  local id="${VMID:-$(next_id)}"
  say "Creando VM del orquestador ($id)"
  qm create "$id" --name cloudplay-orchestrator --machine q35 --bios ovmf --cpu host --cores 4 --memory 8192 \
    --net0 "virtio,bridge=$BRIDGE" --scsihw virtio-scsi-single --agent enabled=1 --ostype l26 --onboot 1 --tags cloudplay \
    --efidisk0 "$STORAGE:0,efitype=4m,pre-enrolled-keys=0" --scsi0 "$STORAGE:${DISK},discard=on,iothread=1,ssd=1" \
    --ide2 "$ISO,media=cdrom" --boot "order=scsi0;ide2" >/dev/null
  qm start "$id"
  ok "VM $id arrancando desde la ISO. Al terminar, saca la ISO: qm set $id --ide2 none"
}

api() {  # método ruta [json]
  local tok
  tok=$(curl -fsS -X POST "$CP_URL/api/auth/login" -H 'content-type: application/json' \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" | jq -r .access_token)
  curl -fsS -X "$1" "$CP_URL$2" -H "authorization: Bearer $tok" -H 'content-type: application/json' ${3:+-d "$3"}
}

cmd_retire() {
  need_pve
  local id="$ARG1" name nid load
  [ -n "$id" ] || die "Uso: $0 retire VMID --cp-url URL --admin-email E --admin-password P"
  [ -n "$CP_URL" ] && [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ] || die "Faltan --cp-url, --admin-email y --admin-password"
  name=$(qm config "$id" | awk '/^name:/ {print $2}')
  nid=$(api GET /api/admin/nodes | jq -r --arg n "$name" '.[] | select(.name==$n) | .id')
  if [ -n "$nid" ]; then
    say "Drenando $name: no recibe partidas nuevas"
    api POST "/api/admin/nodes/$nid/drain" '{"on":true}' >/dev/null
    while :; do
      load=$(api GET /api/admin/nodes | jq -r --arg i "$nid" '.[] | select(.id==$i) | .load')
      [ "${load:-0}" = 0 ] && break
      echo "  quedan $load partidas…"; sleep 20
    done
  fi
  say "Apagando y borrando la VM $id"
  qm shutdown "$id" --timeout 120 || qm stop "$id"
  qm destroy "$id" --purge 1 >/dev/null
  if [ -n "$nid" ]; then api DELETE "/api/admin/nodes/$nid" >/dev/null || true; fi
  ok "Nodo $name retirado sin cortar ninguna partida"
}

case "$CMD" in
  node-template) cmd_node_template ;;
  scale) cmd_scale ;;
  orchestrator-vm) cmd_orchestrator_vm ;;
  retire) cmd_retire ;;
  *) usage; exit 1 ;;
esac
