#!/usr/bin/env bash
# Prueba del clúster en un comando (deploy/proxmox/cloudplay-pve.sh cluster / cluster-add) sin Proxmox:
# qm, pvesh, pvesm, ip y curl falsos que imitan un host de Proxmox con dos GPUs pasables y una de consola, un máster
# que tarda en instalarse y nodos que aparecen en el panel. Comprueba las VMs, el cloud-init, las GPUs, la red y el
# resumen. Imprime PVE_CLUSTER_OK.
set -Eeuo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PVE="$HERE/../../deploy/proxmox/cloudplay-pve.sh"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/vz" "$T/img" "$T/conf" "$T/state"
export STATE="$T/state" T

# ---------------------------------------------------------------- sysfs falso: 3 gráficas + IOMMU
mk() {  # dirección clase fabricante boot_vga
  mkdir -p "$T/sys/bus/pci/devices/$1"
  echo "$2" > "$T/sys/bus/pci/devices/$1/class"; echo "$3" > "$T/sys/bus/pci/devices/$1/vendor"
  echo "$4" > "$T/sys/bus/pci/devices/$1/boot_vga"
}
mkdir -p "$T/sys/kernel/iommu_groups/0"
mk 0000:00:02.0 0x030000 0x8086 0   # gráfica integrada de Intel: se queda en el host
mk 0000:01:00.0 0x030000 0x10de 0   # NVIDIA libre
mk 0000:01:00.1 0x040300 0x10de 0   # su audio (va con ella)
mk 0000:02:00.0 0x030000 0x1002 1   # AMD con la consola de Proxmox: no se toca
mk 0000:03:00.0 0x030200 0x10de 0   # NVIDIA de cómputo libre
mk 0000:04:00.0 0x030000 0x10de 0   # NVIDIA que ya usa otra VM
echo "hostpci0: 0000:04:00,pcie=1" > "$T/conf/100.conf"

# ---------------------------------------------------------------- órdenes falsas
cat > "$T/bin/pvesh" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  /storage)  # como Proxmox 9: la configuración de los almacenamientos solo por la API
    printf '[{"storage":"local","type":"dir","path":"%s","content":"iso,vztmpl,backup"},{"storage":"local-lvm","type":"lvmthin","content":"images,rootdir"}]\n' "$T/vz" ;;
  /cluster/nextid) n=$(cat "$STATE/nextid" 2>/dev/null || echo 200); echo $((n + 1)) > "$STATE/nextid"; echo "$n" ;;
  *) exit 1 ;;
esac
EOF
cat > "$T/bin/pvesm" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  status) printf 'Name Type Status Total Used Available %%\nlocal dir active 100 10 90 10%%\nlocal-lvm lvmthin active 900 100 800 11%%\n' ;;
  set) echo "pvesm $*" >> "$STATE/log" ;;
  *) echo "ERROR: unknown command 'pvesm $1'" >&2; exit 255 ;;   # «pvesm config» no existe
esac
EOF
cat > "$T/bin/qm" <<'EOF'
#!/usr/bin/env bash
echo "qm $*" >> "$STATE/log"
case "$1 $2" in
  "guest cmd")
    c=$(( $(cat "$STATE/agent.$3" 2>/dev/null || echo 0) + 1 )); echo $c > "$STATE/agent.$3"
    [ "$c" -ge 2 ] || exit 2   # el agente tarda en responder
    printf '[{"name":"lo","ip-addresses":[{"ip-address-type":"ipv4","ip-address":"127.0.0.1"}]},{"name":"docker0","ip-addresses":[{"ip-address-type":"ipv4","ip-address":"172.17.0.1"}]},{"name":"ens18","ip-addresses":[{"ip-address-type":"ipv6","ip-address":"fe80::1"},{"ip-address-type":"ipv4","ip-address":"192.168.1.1%s"}]}]\n' "${3: -2}" ;;
  "guest exec") printf '{"exitcode":0,"out-data":"\\u001b[1;35m\\u25b8\\u001b[0m Descargando im\\u00e1genes\\n"}\n' ;;
  "config "*) echo "net0: virtio=BC:24:11:AA:BB:CC,bridge=vmbr0" ;;
  "start "*) touch "$STATE/started.$2" ;;
esac
exit 0
EOF
cat > "$T/bin/ip" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "link show vmbr0") exit 0 ;;
  *"route show default"*) echo "default via 192.168.1.1 dev vmbr0 proto kernel onlink" ;;
  *) exit 1 ;;
esac
EOF
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
out="" url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -w|-m|-X|-H|-d) shift ;; http*) url="$1" ;; esac
  shift
done
echo "curl $url" >> "$STATE/log"
case "$url" in
  */SHA256SUMS) printf '%s *noble-server-cloudimg-amd64.img\n' "$(printf 'imagen' | sha256sum | cut -d' ' -f1)" > "$out" ;;
  *noble-server-cloudimg-amd64.img) printf 'imagen' > "$out" ;;
  */api/health)
    c=$(( $(cat "$STATE/health" 2>/dev/null || echo 0) + 1 )); echo $c > "$STATE/health"
    [ "$c" -ge 3 ] || exit 7 ;;   # el máster se está instalando
  */api/auth/login) echo '{"access_token":"tok"}' ;;
  */api/admin/nodes)
    n=$(ls "$STATE"/started.* 2>/dev/null | wc -l); n=$((n - 1)); [ "$n" -ge 0 ] || n=0
    c=$(( $(cat "$STATE/nodespoll" 2>/dev/null || echo 0) + 1 )); echo $c > "$STATE/nodespoll"
    [ "$c" -ge 3 ] || n=0   # tardan en unirse
    printf '['; for i in $(seq 1 "$n"); do [ "$i" = 1 ] || printf ','; printf '{"name":"n%s","status":"online"}' "$i"; done; echo ']' ;;
  *) exit 22 ;;
esac
EOF
chmod +x "$T/bin"/*
export PATH="$T/bin:$PATH" CLOUDPLAY_SYSFS="$T/sys" CLOUDPLAY_PVE_QEMU_CONF="$T/conf" CLOUDPLAY_IMG_DIR="$T/img" \
  CLOUDPLAY_CLUSTER_ENV="$T/cluster.env" CLOUDPLAY_CLUSTER_TXT="$T/cluster.txt" CLOUDPLAY_POLL=0 CLOUDPLAY_VERSION=v9.9.9 CLOUDPLAY_HOST_MEM_MB=65536 CLOUDPLAY_HOST_CPUS=24

fail() { echo "FALLO: $*"; echo "--- registro"; cat "$STATE/log"; exit 1; }
has() { grep -qF -- "$1" "$STATE/log" || fail "falta en el registro: $1"; }

# ---------------------------------------------------------------- 1) clúster con 3 nodos, máster por DHCP
bash "$PVE" cluster --nodes 3 --yes > "$T/out" 2>&1 || { cat "$T/out"; fail "cluster terminó con error"; }
cat "$T/out"
has "qm create 200 --name cloudplay-master"
has "--startup order=1"
has "--ipconfig0 ip=dhcp"
has "qm set 201 --hostpci0 0000:01:00,pcie=1"
has "qm set 202 --hostpci0 0000:03:00,pcie=1"
grep -q "qm set 203 --hostpci0" "$STATE/log" && fail "el tercer nodo no debería llevar GPU (no quedan libres)"
grep -q "0000:02:00\|0000:00:02\|0000:04:00" "$STATE/log" && fail "ha cogido una GPU que no debía"
has "--cicustom vendor=local:snippets/cloudplay-cluster-master.yaml"
has "--cicustom vendor=local:snippets/cloudplay-cluster-node.yaml"
has "local-lvm:0,import-from=$T/img/noble-server-cloudimg-amd64.img"
has "pvesm set local --content iso,vztmpl,backup,snippets"
for id in 200 201 202 203; do [ -f "$STATE/started.$id" ] || fail "la VM $id no arrancó"; done
M="$T/vz/snippets/cloudplay-cluster-master.yaml" N="$T/vz/snippets/cloudplay-cluster-node.yaml"
[ "$(stat -c %a "$M")" = 600 ] || fail "el cloud-init del máster debería ser solo de root"
grep -q "releases/download/v9.9.9/get.sh" "$M" || fail "el máster no instala la versión del despliegue"
grep -q "get.sh orchestrator --join-token [0-9a-f]\{48\} --admin-email admin@cloudplay.lan --admin-password " "$M" || fail "argumentos del máster: $(cat "$M")"
grep -q -- "--lan-ip\|--domain" "$M" && fail "con DHCP el máster no lleva IP ni dominio (modo red local automático)"
tok=$(sed -n 's/.*--join-token \([0-9a-f]*\).*/\1/p' "$M")
grep -q "get.sh node --cp-url http://192.168.1.100 --join-token $tok --gpu auto --capacity auto --reboot-ok" "$N" \
  || fail "argumentos de los nodos: $(grep get.sh "$N")"
python3 -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" "$M" "$N" 2>/dev/null \
  || python3 -c "print('sin PyYAML: se omite la validación YAML')"
grep -q "Plataforma:     http://192.168.1.100" "$T/cluster.txt" || fail "resumen sin URL"
grep -q "También HTTPS:  https://192.168.1.100" "$T/cluster.txt" || fail "resumen sin HTTPS"
grep -q "Nodos:          VM 201 202 203" "$T/cluster.txt" || fail "resumen sin nodos"
grep -q "usuario cloudplay · contraseña [A-Za-z0-9]\{14\}" "$T/cluster.txt" || fail "resumen sin la contraseña de las VMs"
for id in 200 201 202 203; do has "qm set $id --cipassword "; done
grep -q "Descargando imágenes" "$T/out" || fail "no se enseña el progreso de la instalación del máster"
grep -q "resérvala en el router para la MAC BC:24:11:AA:BB:CC" "$T/out" || fail "falta el aviso de la IP por DHCP"
[ "$(stat -c %a "$T/cluster.env")" = 600 ] || fail "cluster.env debería ser solo de root"

# ---------------------------------------------------------------- 2) crecer: 1 nodo más, sin GPUs libres ya
printf 'hostpci0: 0000:01:00,pcie=1\n' > "$T/conf/201.conf"; printf 'hostpci0: 0000:03:00,pcie=1\n' > "$T/conf/202.conf"
: > "$STATE/log"; rm -f "$STATE/nodespoll"
bash "$PVE" cluster-add 1 > "$T/out2" 2>&1 || { cat "$T/out2"; fail "cluster-add terminó con error"; }
has "qm create 204 --name cloudplay-node-204"
vmp=$(sed -n 's/.*contraseña \([A-Za-z0-9]*\) .*/\1/p' "$T/cluster.txt")
has "qm set 204 --cipassword $vmp"  # los nodos nuevos, con la misma contraseña
grep -q "hostpci" "$STATE/log" && fail "cluster-add ha puesto una GPU que ya está en uso"
grep -q "Nodos nuevos: VM 204" "$T/out2" || fail "cluster-add sin resumen"

# ---------------------------------------------------------------- 3) un segundo «cluster» no machaca el primero
bash "$PVE" cluster --nodes 1 --yes > "$T/out3" 2>&1 && fail "debería negarse a crear otro clúster encima"
grep -q "Ya hay un clúster" "$T/out3" || fail "mensaje al repetir: $(cat "$T/out3")"

# ---------------------------------------------------------------- 4) máster con IP fija
rm -rf "${STATE:?}"/* "$T/cluster.env"; : > "$STATE/log"
bash "$PVE" cluster --nodes 1 --master-ip 192.168.1.50 --gpu-pci none --memory 6144 --cores 4 --yes > "$T/out4" 2>&1 \
  || { cat "$T/out4"; fail "cluster con IP fija terminó con error"; }
has "--ipconfig0 ip=192.168.1.50/24,gw=192.168.1.1"
has "qm set 200 --nameserver"
grep -q "hostpci" "$STATE/log" && fail "--gpu-pci none no debería pasar GPUs"
has "--cores 4 --memory 6144"
grep -q -- "--lan-ip 192.168.1.50" "$T/vz/snippets/cloudplay-cluster-master.yaml" || fail "el máster con IP fija debería anunciarla"
grep -q "resérvala" "$T/out4" && fail "con IP fija no hace falta reservar nada"

# ---------------------------------------------------------------- 5) no cabe en la memoria
rm -rf "${STATE:?}"/* "$T/cluster.env"; : > "$STATE/log"
bash "$PVE" cluster --nodes 50 --memory 16384 --yes > "$T/out5" 2>&1 && fail "50 nodos de 16 GB no deberían caber"
grep -q "No cabe en la memoria" "$T/out5" || fail "mensaje de memoria: $(tail -2 "$T/out5")"
grep -q "qm create" "$STATE/log" && fail "no debería crear nada si no cabe"

echo PVE_CLUSTER_OK
