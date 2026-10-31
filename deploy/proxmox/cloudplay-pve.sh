#!/usr/bin/env bash
# CloudPlay en Proxmox VE 8/9: el clúster entero en un comando, plantilla de nodo gaming, clones y retirada sin
# cortar partidas. Se ejecuta en el host de Proxmox como root (viaja en la imagen ghcr.io/…/cloudplay-pve).
#
#   0) TODO de una vez: un máster (orquestador) + N nodos gaming con red, GPU y CloudPlay ya configurados
#        ./cloudplay-pve.sh cluster --nodes 3 [--master-ip 192.168.1.50/24] [--gpu-pci auto|none|0000:01:00,...]
#        ./cloudplay-pve.sh cluster-add 2      (más nodos para el clúster creado con «cluster»)
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

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_VERSION="${CLOUDPLAY_VERSION:-$(cat "$HERE/VERSION" 2>/dev/null || echo latest)}"
[ "$RELEASE_VERSION" != latest ] || RELEASE_VERSION=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  "https://github.com/${CLOUDPLAY_REPO:-fieropirata275/CloudPlay}/releases/latest" 2>/dev/null | sed 's#.*/##') || true
RELEASE_REPO="${CLOUDPLAY_REPO:-fieropirata275/CloudPlay}"
NODES=1 MASTER_IP="" GATEWAY="" DNS="" MASTER_CORES=4 MASTER_MEMORY=8192 MASTER_DISK=48 DOMAIN="" TUNNEL_TOKEN="" YES=0
SNIPPETS_SET=0 STORAGE_SET=0 BRIDGE_SET=0 GPU_SET=0 CORES_SET=0 MEMORY_SET=0 IMG="" MASTER_URL="" MASTER_ADDR="" MASTER_VMID="" NEW_NODE_IDS=""
CLUSTER_ENV="${CLOUDPLAY_CLUSTER_ENV:-/root/cloudplay-cluster.env}" CLUSTER_TXT="${CLOUDPLAY_CLUSTER_TXT:-/root/cloudplay-cluster.txt}"
SYSFS="${CLOUDPLAY_SYSFS:-/sys}" PVE_QEMU_CONF="${CLOUDPLAY_PVE_QEMU_CONF:-/etc/pve/qemu-server}"
POLL="${CLOUDPLAY_POLL:-10}" BOOT_TIMEOUT=900 INSTALL_TIMEOUT=3600 NODE_TIMEOUT=5400
STORAGE=local-lvm SNIPPETS=local BRIDGE=vmbr0 TEMPLATE_ID=9100 CORES=8 MEMORY=16384 DISK=64 PREFIX=cloudplay-node
CP_URL="" JOIN_TOKEN="" GPU=auto GPU_PCI="" ISO="" VMID="" SSH_KEY="" ADMIN_EMAIL="" ADMIN_PASSWORD="" CAPACITY=auto
IMG_URL=https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
IMG_DIR="${CLOUDPLAY_IMG_DIR:-/var/lib/vz/template/cloudplay}"

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'

Opciones: --storage local-lvm --snippets local --bridge vmbr0 --template 9100 --vmid N
          --cores 8 --memory 16384 --disk 64 --prefix cloudplay-node --gpu auto|nvidia|vaapi|cpu
          --capacity auto|N --ssh-key ~/.ssh/id_ed25519.pub
Clúster:  --nodes N --master-ip IP/MÁSCARA --gateway IP --dns IP --master-cores 4 --master-memory 8192
          --master-disk 48 --gpu-pci auto|none|lista --domain D --tunnel-token T --admin-email E --yes
          Sin --domain la plataforma va por la IP del máster (http://IP y https://IP).
          --cores/--memory/--disk son los de cada nodo.
EOF
}

CMD="${1:-}"; shift || true
ARG1=""
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then ARG1="$1"; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --storage) STORAGE="$2"; STORAGE_SET=1; shift ;;
    --snippets) SNIPPETS="$2"; SNIPPETS_SET=1; shift ;;
    --bridge) BRIDGE="$2"; BRIDGE_SET=1; shift ;;
    --nodes) NODES="$2"; shift ;;
    --master-ip) MASTER_IP="$2"; shift ;;
    --gateway) GATEWAY="$2"; shift ;;
    --dns) DNS="$2"; shift ;;
    --master-cores) MASTER_CORES="$2"; shift ;;
    --master-memory) MASTER_MEMORY="$2"; shift ;;
    --master-disk) MASTER_DISK="$2"; shift ;;
    --domain) DOMAIN="$2"; shift ;;
    --tunnel-token) TUNNEL_TOKEN="$2"; shift ;;
    -y|--yes) YES=1 ;;
    --template) TEMPLATE_ID="$2"; shift ;;
    --vmid) VMID="$2"; shift ;;
    --cores) CORES="$2"; CORES_SET=1; shift ;;
    --memory) MEMORY="$2"; MEMORY_SET=1; shift ;;
    --disk) DISK="$2"; shift ;;
    --prefix) PREFIX="$2"; shift ;;
    --cp-url) CP_URL="${2%/}"; shift ;;
    --join-token) JOIN_TOKEN="$2"; shift ;;
    --gpu) GPU="$2"; shift ;;
    --gpu-pci) GPU_PCI="$2"; GPU_SET=1; shift ;;
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
  # Ruta en disco del almacenamiento de snippets (y lo habilita si hace falta). La configuración de los
  # almacenamientos se lee con la API (pvesh), igual en Proxmox 8 y 9. Tiene que ser uno con carpeta (dir, NFS, CIFS…).
  local all st content path
  all=$(pvesh get /storage --output-format json 2>/dev/null) || die "No se pudo leer la lista de almacenamientos (pvesh get /storage)"
  st=$(echo "$all" | jq -c --arg s "$SNIPPETS" '.[] | select(.storage == $s and (.path // "") != "" and (.disable // 0) == 0)' | head -n1)
  if [ -z "$st" ] && [ "$SNIPPETS_SET" = 0 ]; then
    # sin «local» (renombrado o borrado): el primer almacenamiento con carpeta que haya
    st=$(echo "$all" | jq -c '[.[] | select((.path // "") != "" and (.disable // 0) == 0)] | (map(select(.type == "dir")) + .) | .[0] // empty')
  fi
  [ -n "$st" ] || die "No hay ningún almacenamiento con carpeta para los snippets de cloud-init (${SNIPPETS}). Usa --snippets NOMBRE"
  SNIPPETS=$(echo "$st" | jq -r '.storage')
  content=$(echo "$st" | jq -r '.content // ""')
  path=$(echo "$st" | jq -r '.path')
  if [[ ",$content," != *,snippets,* ]]; then
    say "Habilitando «snippets» en $SNIPPETS (necesario para cloud-init personalizado)" >&2
    pvesm set "$SNIPPETS" --content "${content:+$content,}snippets" >&2 || die "No se pudo habilitar «snippets» en $SNIPPETS"
  fi
  mkdir -p "$path/snippets"
  echo "$path/snippets"
}

# Imagen cloud oficial de Ubuntu 24.04 (se descarga una vez y se verifica con su SHA256). Escribe su ruta.
ubuntu_image() {
  local img="$IMG_DIR/noble-server-cloudimg-amd64.img"
  say "Imagen cloud de Ubuntu 24.04" >&2
  mkdir -p "$IMG_DIR"
  curl -fsSL "${IMG_URL%/*}/SHA256SUMS" -o "$IMG_DIR/SHA256SUMS"
  if ! (cd "$IMG_DIR" && grep ' \*noble-server-cloudimg-amd64.img$' SHA256SUMS | sha256sum -c --quiet - >/dev/null 2>&1); then
    curl -fL --progress-bar "$IMG_URL" -o "$img" >&2
    (cd "$IMG_DIR" && grep ' \*noble-server-cloudimg-amd64.img$' SHA256SUMS | sha256sum -c --quiet - >&2) || die "Imagen corrupta"
  fi
  echo "$img"
}

cmd_node_template() {
  need_pve
  need_tools
  [ -n "$CP_URL" ] && [ -n "$JOIN_TOKEN" ] || die "Faltan --cp-url y --join-token (en el orquestador: cloudplay node-command)"
  local id="${VMID:-$TEMPLATE_ID}" snip img
  qm status "$id" >/dev/null 2>&1 && die "Ya existe la VM $id (usa --vmid)"

  img=$(ubuntu_image)

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

# ================================================================== CLÚSTER EN UN COMANDO
# Máster (orquestador) + N nodos gaming: VMs de Ubuntu 24.04 con cloud-init que instalan CloudPlay solas. El máster
# nace con el token de unión y la contraseña de administrador que se generan aquí, así los nodos se unen sin pasos.

warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }

need_tools() {
  local missing=() t
  for t in jq curl openssl; do command -v "$t" >/dev/null || missing+=("$t"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    say "Instalando ${missing[*]}"
    apt-get install -y -qq "${missing[@]}" >/dev/null || die "No se pudo instalar ${missing[*]}"
  fi
}

# Almacenamiento para los discos: el de --storage o el mejor con contenido «images» (local-lvm, local-zfs, el más libre)
pick_storage() {
  local list best
  list=$(pvesm status --content images --enabled 1 2>/dev/null | awk 'NR > 1 && $3 == "active" {print $1, $6}')
  [ -n "$list" ] || die "No hay ningún almacenamiento activo para discos de VM"
  if [ "$STORAGE_SET" = 1 ]; then
    echo "$list" | awk -v s="$STORAGE" '$1 == s {f = 1} END {exit !f}' || die "El almacenamiento $STORAGE no admite discos de VM"
    return 0
  fi
  for best in local-lvm local-zfs; do
    if echo "$list" | awk -v s="$best" '$1 == s {f = 1} END {exit !f}'; then STORAGE="$best"; return 0; fi
  done
  STORAGE=$(echo "$list" | sort -k2 -n -r | awk 'NR == 1 {print $1}')
}

pick_bridge() {
  if ip link show "$BRIDGE" >/dev/null 2>&1; then return 0; fi
  [ "$BRIDGE_SET" = 0 ] || die "No existe el puente $BRIDGE"
  BRIDGE=$(ip -o link show type bridge 2>/dev/null | awk -F': ' '$2 ~ /^vmbr/ {print $2; exit}')
  [ -n "$BRIDGE" ] || die "No hay ningún puente vmbrX en este Proxmox (créalo en Sistema → Red)"
}

# Red del puente: puerta de enlace y DNS para la IP fija del máster (los nodos van por DHCP)
host_net() {
  [ -n "$GATEWAY" ] || GATEWAY=$(ip -4 route show default dev "$BRIDGE" 2>/dev/null | awk '{print $3; exit}')
  [ -n "$GATEWAY" ] || GATEWAY=$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')
  [ -n "$DNS" ] || DNS=$(awk '/^nameserver/ && $2 !~ /^127\./ {print $2; exit}' /etc/resolv.conf 2>/dev/null)
  [ -n "$DNS" ] || DNS="$GATEWAY"
}

# GPUs dedicadas que se pueden pasar a las VMs: NVIDIA/AMD (e Intel Arc), con IOMMU activo, sin la que usa la consola
# de Proxmox y sin las que ya tiene otra VM. Una por nodo; los nodos sin GPU codifican por CPU.
detect_gpus() {
  local dev cls ven addr used
  [ -d "$SYSFS/kernel/iommu_groups" ] && [ -n "$(ls -A "$SYSFS/kernel/iommu_groups" 2>/dev/null)" ] || return 0
  used=$(grep -h '^hostpci' "$PVE_QEMU_CONF"/*.conf 2>/dev/null | sed 's/^hostpci[0-9]*: *//; s/[,;].*//; s/\.[0-9]$//' \
    | sed 's/^\([0-9a-f][0-9a-f]:\)/0000:\1/') || true
  for dev in "$SYSFS"/bus/pci/devices/*; do
    addr=$(basename "$dev")
    [ "${addr##*.}" = 0 ] || continue
    cls=$(cat "$dev/class" 2>/dev/null) ven=$(cat "$dev/vendor" 2>/dev/null)
    case "$cls" in 0x0300*|0x0302*|0x0380*) ;; *) continue ;; esac
    case "$ven" in
      0x10de|0x1002) ;;
      0x8086) [[ "$addr" == 0000:00:* ]] && continue ;;  # la gráfica integrada se queda para el host
      *) continue ;;
    esac
    [ "$(cat "$dev/boot_vga" 2>/dev/null)" = 1 ] && continue
    addr="${addr%.*}"
    if [ -n "$used" ] && echo "$used" | grep -qx "$addr"; then continue; fi
    echo "$addr"
  done
}

# Fragmento cloud-init: agente de QEMU (para leer la IP y el progreso desde aquí) y CloudPlay en el primer arranque
write_snippet() {  # fichero, argumentos de get.sh
  local snip
  snip=$(snippets_path)
  cat > "$snip/$1" <<EOF
#cloud-config
package_update: true
packages: [curl, qemu-guest-agent]
runcmd:
  - systemctl enable --now qemu-guest-agent
  - curl -fsSL https://github.com/$RELEASE_REPO/releases/download/$RELEASE_VERSION/get.sh -o /root/cloudplay-get.sh
  - CLOUDPLAY_VERSION=$RELEASE_VERSION bash /root/cloudplay-get.sh $2 > /var/log/cloudplay-firstboot.log 2>&1
EOF
  chmod 600 "$snip/$1"  # lleva el token de unión y la contraseña: solo root
}

create_vm() {  # id nombre núcleos memoria disco snippet ipconfig [gpu] [orden de arranque]
  local id="$1"
  qm create "$id" --name "$2" --machine q35 --bios ovmf --cpu host --cores "$3" --memory "$4" --balloon 0 \
    --net0 "virtio,bridge=$BRIDGE" --scsihw virtio-scsi-single --agent enabled=1 --ostype l26 --serial0 socket \
    --vga std --tags cloudplay --onboot 1 --startup "order=${9:-2}" >/dev/null
  qm set "$id" --efidisk0 "$STORAGE:0,efitype=4m,pre-enrolled-keys=0" >/dev/null
  qm set "$id" --scsi0 "$STORAGE:0,import-from=$IMG,discard=on,iothread=1,ssd=1" >/dev/null
  qm resize "$id" scsi0 "${5}G" >/dev/null
  qm set "$id" --ide2 "$STORAGE:cloudinit" --boot order=scsi0 --ipconfig0 "$7" --ciuser cloudplay \
    --cicustom "vendor=$SNIPPETS:snippets/$6" >/dev/null
  if [ -n "$SSH_KEY" ]; then qm set "$id" --sshkeys "$SSH_KEY" >/dev/null; fi
  if [ -n "${8:-}" ]; then qm set "$id" --hostpci0 "$8,pcie=1" >/dev/null; fi
}

# IPv4 de la VM según su agente de QEMU (vacío mientras no responde)
guest_ip() {
  qm guest cmd "$1" network-get-interfaces 2>/dev/null | jq -r '.[] | select(.name | test("^(lo|docker|br-|veth|virbr)") | not)
    | ."ip-addresses"[]? | select(."ip-address-type" == "ipv4") | ."ip-address"' 2>/dev/null | head -n1 || true
}

# Último paso que ha escrito el instalador dentro de la VM (para enseñar el progreso aquí)
guest_progress() {
  qm guest exec "$1" --timeout 10 -- sh -c "grep -a '▸\|✔\|✘' /var/log/cloudplay-firstboot.log 2>/dev/null | tail -n1" 2>/dev/null \
    | jq -r '."out-data" // empty' 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | tr -d '\n' | cut -c1-90 || true
}

elapsed() { local s=$(( $(date +%s) - $1 )); printf '%d:%02d' $((s / 60)) $((s % 60)); }

wait_for() {  # descripción, segundos, comprobación, [vmid para enseñar su progreso]
  local t0 last="" p
  t0=$(date +%s)
  while ! "$3"; do
    if [ $(( $(date +%s) - t0 )) -ge "$2" ]; then printf '\n'; return 1; fi
    p=""
    if [ -n "${4:-}" ]; then p=$(guest_progress "$4"); fi
    if [ -n "$p" ]; then last="$p"; fi
    printf '\r\033[K  %s · %s%s' "$1" "$(elapsed "$t0")" "${last:+ · $last}"
    sleep "$POLL"
  done
  printf '\r\033[K'
  ok "$1 ($(elapsed "$t0"))"
}

api_master() {  # método ruta
  local tok
  tok=$(curl -fsS -m 10 -X POST "$MASTER_URL/api/auth/login" -H 'content-type: application/json' \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" | jq -r .access_token) || return 1
  curl -fsS -m 10 -X "$1" "$MASTER_URL$2" -H "authorization: Bearer $tok"
}

online_nodes() { api_master GET /api/admin/nodes 2>/dev/null | jq '[.[] | select(.status == "online")] | length' 2>/dev/null || echo 0; }

save_cluster() {
  ( umask 077
    {
      printf 'MASTER_VMID=%q\nMASTER_URL=%q\nMASTER_ADDR=%q\nJOIN_TOKEN=%q\n' "$MASTER_VMID" "$MASTER_URL" "$MASTER_ADDR" "$JOIN_TOKEN"
      printf 'ADMIN_EMAIL=%q\nADMIN_PASSWORD=%q\nRELEASE_VERSION=%q\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$RELEASE_VERSION"
      printf 'STORAGE=%q\nBRIDGE=%q\nCORES=%q\nMEMORY=%q\nDISK=%q\nPREFIX=%q\n' "$STORAGE" "$BRIDGE" "$CORES" "$MEMORY" "$DISK" "$PREFIX"
    } > "$CLUSTER_ENV"
  )
}

# Crea N nodos que se unen al máster de MASTER_URL, con una GPU libre cada uno si hay, y espera a verlos en el panel
add_nodes() {
  local n="$1" i id name gpu gpus=() want
  if [ "$GPU_PCI" = auto ]; then mapfile -t gpus < <(detect_gpus)
  elif [ -n "$GPU_PCI" ] && [ "$GPU_PCI" != none ]; then IFS=, read -r -a gpus <<< "$GPU_PCI"; fi
  write_snippet cloudplay-cluster-node.yaml "node --cp-url $MASTER_URL --join-token $JOIN_TOKEN --gpu $GPU --capacity $CAPACITY --reboot-ok"
  want=$(( $(online_nodes) + n ))
  NEW_NODE_IDS=""
  for i in $(seq 1 "$n"); do
    id=$(next_id)
    name="$PREFIX-$id"
    gpu="${gpus[$((i - 1))]:-}"
    if [ -n "$gpu" ]; then say "Nodo $name ($id) · GPU $gpu en passthrough"; else say "Nodo $name ($id) · sin GPU: codifica por CPU"; fi
    create_vm "$id" "$name" "$CORES" "$MEMORY" "$DISK" cloudplay-cluster-node.yaml ip=dhcp "$gpu" 2
    qm start "$id" >/dev/null
    NEW_NODE_IDS="${NEW_NODE_IDS:+$NEW_NODE_IDS }$id"
  done
  nodes_ready() { [ "$(online_nodes)" -ge "$want" ]; }
  wait_for "Nodos instalándose y uniéndose al máster" "$NODE_TIMEOUT" nodes_ready "${NEW_NODE_IDS%% *}" \
    || warn "Aún no están todos: siguen instalándose solos (con NVIDIA reinician una vez). Míralo en el panel."
}

cmd_cluster() {
  need_pve
  need_tools
  [[ "$NODES" =~ ^[0-9]+$ ]] || die "--nodes tiene que ser un número"
  [ "$GPU_SET" = 1 ] || GPU_PCI=auto
  [ ! -f "$CLUSTER_ENV" ] || die "Ya hay un clúster creado desde aquí ($CLUSTER_ENV). Para crecer: cluster-add N"
  pick_storage
  pick_bridge
  host_net
  local gpus=() need_mem host_mem host_cpu need_cpu ipcfg master_args a mac gtxt
  if [ "$GPU_PCI" = auto ]; then mapfile -t gpus < <(detect_gpus)
  elif [ -n "$GPU_PCI" ] && [ "$GPU_PCI" != none ]; then IFS=, read -r -a gpus <<< "$GPU_PCI"; fi
  if [ "${#gpus[@]}" -gt 0 ]; then gtxt="${gpus[*]} (una por nodo)"; else gtxt="ninguna libre: los nodos codifican por CPU"; fi

  # ¿Cabe? (sin globos de memoria: las VMs con GPU la reservan entera). Sin --memory/--cores, cada nodo se ajusta a
  # lo que deja el host (hasta 16 GB y 8 núcleos; mínimo 4 GB y 2 núcleos) guardando un 15 % para Proxmox.
  host_mem="${CLOUDPLAY_HOST_MEM_MB:-$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)}"
  host_cpu="${CLOUDPLAY_HOST_CPUS:-$(nproc)}"
  if [ "$NODES" -gt 0 ] && [ "$MEMORY_SET" = 0 ]; then
    MEMORY=$(( (host_mem * 85 / 100 - MASTER_MEMORY) / NODES / 1024 * 1024 ))
    if [ "$MEMORY" -gt 16384 ]; then MEMORY=16384; fi
    if [ "$MEMORY" -lt 4096 ]; then MEMORY=4096; fi
  fi
  if [ "$NODES" -gt 0 ] && [ "$CORES_SET" = 0 ]; then
    CORES=$(( (host_cpu - 2) / NODES ))
    if [ "$CORES" -gt 8 ]; then CORES=8; fi
    if [ "$CORES" -lt 2 ]; then CORES=2; fi
  fi
  need_mem=$(( MASTER_MEMORY + NODES * MEMORY ))
  need_cpu=$(( MASTER_CORES + NODES * CORES ))
  printf '\n  \033[1mCloudPlay en este Proxmox\033[0m\n'
  printf '  Máster        1 VM · %s núcleos · %s MB · %s GB · %s\n' "$MASTER_CORES" "$MASTER_MEMORY" "$MASTER_DISK" "${MASTER_IP:-IP por DHCP}"
  printf '  Nodos gaming  %s VM · %s núcleos · %s MB · %s GB · DHCP\n' "$NODES" "$CORES" "$MEMORY" "$DISK"
  printf '  GPUs          %s\n' "$gtxt"
  printf '  Disco y red   %s · %s (puerta de enlace %s)\n' "$STORAGE" "$BRIDGE" "${GATEWAY:-?}"
  if [ -n "$DOMAIN" ]; then printf '  Plataforma    https://%s\n' "$DOMAIN"; else printf '  Plataforma    por la IP del máster (http y https)\n'; fi
  printf '  Necesita      %s MB de %s MB · %s núcleos de %s\n\n' "$need_mem" "$host_mem" "$need_cpu" "$host_cpu"
  [ "$need_mem" -lt "$host_mem" ] || die "No cabe en la memoria del host: baja --memory (de cada nodo) o --nodes"
  if [ "$need_cpu" -gt $(( host_cpu * 2 )) ]; then warn "Muchos más núcleos virtuales que reales: irá justo (baja --cores)"; fi
  if [ "$YES" = 0 ] && [ -t 0 ]; then
    read -r -p "  ¿Crear el clúster? [S/n] " a
    case "$a" in n|N|no|NO) die "Cancelado" ;; esac
  fi

  IMG=$(ubuntu_image)
  JOIN_TOKEN="${JOIN_TOKEN:-$(openssl rand -hex 24)}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-18)}"
  if [ -n "$DOMAIN" ]; then ADMIN_EMAIL="${ADMIN_EMAIL:-admin@${DOMAIN#*.}}"; else ADMIN_EMAIL="${ADMIN_EMAIL:-admin@cloudplay.lan}"; fi

  # ---------------------------------------------------------------- máster
  MASTER_VMID=$(next_id)
  master_args="orchestrator --join-token $JOIN_TOKEN --admin-email $ADMIN_EMAIL --admin-password $ADMIN_PASSWORD"
  if [ -n "$DOMAIN" ]; then master_args+=" --domain $DOMAIN"; fi
  if [ -n "$TUNNEL_TOKEN" ]; then master_args+=" --tunnel-token $TUNNEL_TOKEN"; fi
  if [ -n "$MASTER_IP" ]; then
    [[ "$MASTER_IP" == */* ]] || MASTER_IP="$MASTER_IP/24"
    ipcfg="ip=$MASTER_IP,gw=$GATEWAY"
    if [ -z "$DOMAIN" ]; then master_args+=" --lan-ip ${MASTER_IP%/*}"; fi
  else
    ipcfg="ip=dhcp"
  fi
  write_snippet cloudplay-cluster-master.yaml "$master_args"
  say "Máster cloudplay-master ($MASTER_VMID)"
  create_vm "$MASTER_VMID" cloudplay-master "$MASTER_CORES" "$MASTER_MEMORY" "$MASTER_DISK" cloudplay-cluster-master.yaml "$ipcfg" "" 1
  if [ -n "$MASTER_IP" ]; then qm set "$MASTER_VMID" --nameserver "$DNS" >/dev/null; fi
  qm start "$MASTER_VMID" >/dev/null

  MASTER_ADDR=""
  master_has_ip() { MASTER_ADDR=$(guest_ip "$MASTER_VMID"); [ -n "$MASTER_ADDR" ]; }
  wait_for "Máster arrancado" "$BOOT_TIMEOUT" master_has_ip || die "El máster no da señales: mira su consola en Proxmox (VM $MASTER_VMID)"
  if [ -n "$DOMAIN" ]; then MASTER_URL="https://$DOMAIN"; else MASTER_URL="http://$MASTER_ADDR"; fi
  ok "Máster en $MASTER_ADDR"
  master_up() { curl -fsS -m 5 "$MASTER_URL/api/health" >/dev/null 2>&1; }
  wait_for "Instalando CloudPlay en el máster" "$INSTALL_TIMEOUT" master_up "$MASTER_VMID" \
    || die "El máster no acaba de instalarse. Registro: qm guest exec $MASTER_VMID -- tail -n 40 /var/log/cloudplay-firstboot.log"
  save_cluster

  # ---------------------------------------------------------------- nodos
  NEW_NODE_IDS=""
  if [ "$NODES" -gt 0 ]; then add_nodes "$NODES"; fi

  # ---------------------------------------------------------------- resumen
  mac=$(qm config "$MASTER_VMID" | sed -n 's/^net0: virtio=\([0-9A-Fa-f:]*\).*/\1/p')
  ( umask 077
    {
      echo "CloudPlay · clúster en Proxmox"
      echo "=============================="
      echo "Plataforma:     $MASTER_URL"
      if [ -z "$DOMAIN" ]; then echo "También HTTPS:  https://$MASTER_ADDR  (certificado propio de la red: el navegador avisa la primera vez)"; fi
      echo "Panel:          $MASTER_URL/#/admin"
      echo "Administrador:  $ADMIN_EMAIL"
      echo "Contraseña:     $ADMIN_PASSWORD"
      echo
      echo "Máster:         VM $MASTER_VMID (cloudplay-master) · $MASTER_ADDR"
      echo "Nodos:          VM ${NEW_NODE_IDS:-ninguno}"
      echo "Token de unión: $JOIN_TOKEN"
      echo
      echo "Juegos y BIOS:  en el máster, /srv/cloudplay/library/{ps2,gc,wii} y /srv/cloudplay/bios"
      echo "Más nodos:      curl -fsSL https://github.com/$RELEASE_REPO/releases/latest/download/get.sh | bash -s -- proxmox cluster-add 2"
    } > "$CLUSTER_TXT"
  )
  echo
  cat "$CLUSTER_TXT"
  echo
  ok "Guardado en $CLUSTER_TXT (solo root)"
  if [ -z "$MASTER_IP" ] && [ -z "$DOMAIN" ]; then
    warn "El máster tiene la IP por DHCP: resérvala en el router para la MAC $mac (si cambiara, los nodos lo perderían)."
  fi
}

cmd_cluster_add() {
  need_pve
  need_tools
  [ -f "$CLUSTER_ENV" ] || die "No hay clúster creado desde este Proxmox ($CLUSTER_ENV). Primero: cluster --nodes N"
  local n="${ARG1:-1}" c="$CORES" m="$MEMORY" d="$DISK" cs="$CORES_SET" ms="$MEMORY_SET"
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] || die "Uso: cluster-add N"
  # shellcheck disable=SC1090
  . "$CLUSTER_ENV"
  # lo que se pase ahora manda sobre lo guardado
  if [ "$cs" = 1 ]; then CORES="$c"; fi
  if [ "$ms" = 1 ]; then MEMORY="$m"; fi
  if [ "$d" != 64 ]; then DISK="$d"; fi
  [ "$GPU_SET" = 1 ] || GPU_PCI=auto
  curl -fsS -m 5 "$MASTER_URL/api/health" >/dev/null 2>&1 || die "El máster ($MASTER_URL) no responde"
  IMG=$(ubuntu_image)
  add_nodes "$n"
  ok "Nodos nuevos: VM $NEW_NODE_IDS"
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
  cluster) cmd_cluster ;;
  cluster-add) cmd_cluster_add ;;
  node-template) cmd_node_template ;;
  scale) cmd_scale ;;
  orchestrator-vm) cmd_orchestrator_vm ;;
  retire) cmd_retire ;;
  *) usage; exit 1 ;;
esac
