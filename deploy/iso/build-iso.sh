#!/usr/bin/env bash
# Crea una ISO de Ubuntu Server 24.04 que se instala sola con CloudPlay ya configurado.
#
# Paso 1 · crear la ISO (en cualquier Linux con xorriso):
#   ./build-iso.sh --role orchestrator --domain play.empresa.com --tunnel-token TOKEN
#   ./build-iso.sh --role node --cp-url https://play.empresa.com --join-token TOKEN
# Paso 2 · arrancar el servidor (o la VM) con la ISO. Ubuntu se instala, reinicia y CloudPlay se instala
#          en el primer arranque. Al terminar, las credenciales están en /root/cloudplay-credenciales.txt.
#
# Opciones propias de la ISO (el resto se pasa tal cual a deploy/install/install.sh):
#   --ubuntu-iso FICHERO   ISO oficial ya descargada (si no, se descarga y se verifica su SHA256)
#   --hostname NOMBRE      nombre de la máquina (por defecto cloudplay-<rol>)
#   --user USUARIO         usuario administrador (cloudplay)
#   --password CLAVE       su contraseña (si no, se genera una)
#   --ssh-key FICHERO      clave pública SSH autorizada (y se desactiva el acceso por contraseña)
#   --timezone ZONA        Europe/Madrid
#   --keyboard DISPOSICIÓN es
#   --unattended           no pedir confirmación antes de borrar el disco (para despliegues masivos)
#   -o FICHERO             ISO de salida (cloudplay-<rol>.iso)
#
# ⚠️ La ISO lleva dentro los tokens que le pases: trátala como un secreto.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
UBUNTU_ISO="" HOSTNAME_="" USER_=cloudplay PASSWORD="" SSH_KEY="" TZ_=Europe/Madrid KB=es UNATTENDED=0 OUT="" ROLE=""
PASS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --ubuntu-iso) UBUNTU_ISO="$2"; shift ;;
    --hostname) HOSTNAME_="$2"; shift ;;
    --user) USER_="$2"; shift ;;
    --password) PASSWORD="$2"; shift ;;
    --ssh-key) SSH_KEY="$2"; shift ;;
    --timezone) TZ_="$2"; shift ;;
    --keyboard) KB="$2"; shift ;;
    --unattended) UNATTENDED=1 ;;
    -o|--output) OUT="$2"; shift ;;
    --role) ROLE="$2"; PASS+=("$1" "$2"); shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) # opción del instalador: con o sin valor
      if [ $# -ge 2 ] && [[ "$2" != --* ]]; then PASS+=("$1" "$2"); shift; else PASS+=("$1"); fi ;;
    *) echo "Argumento inesperado: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }

case "$ROLE" in orchestrator|node|all) ;; *) die "Indica --role orchestrator, node o all (mira --help)" ;; esac
for t in xorriso curl openssl sha256sum tar; do command -v "$t" >/dev/null || die "Falta $t (sudo apt install xorriso curl openssl)"; done
[[ "$USER_" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Usuario no válido: $USER_"
HOSTNAME_="${HOSTNAME_:-cloudplay-$ROLE}"
OUT="${OUT:-cloudplay-$ROLE.iso}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ------------------------------------------------------------ ISO oficial de Ubuntu
if [ -z "$UBUNTU_ISO" ]; then
  BASE=https://releases.ubuntu.com/24.04
  say "Buscando la última Ubuntu Server 24.04 LTS"
  curl -fsSL "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"
  NAME=$(grep -o 'ubuntu-24\.04[0-9.]*-live-server-amd64\.iso' "$WORK/SHA256SUMS" | sort -V | tail -1)
  [ -n "$NAME" ] || die "No encuentro la ISO de servidor en $BASE"
  UBUNTU_ISO="$NAME"
  if [ ! -f "$UBUNTU_ISO" ]; then
    say "Descargando $NAME (unos 3 GB)"
    curl -fL --progress-bar "$BASE/$NAME" -o "$UBUNTU_ISO.part"
    mv "$UBUNTU_ISO.part" "$UBUNTU_ISO"
  fi
  say "Verificando SHA256"
  (cd "$(dirname "$UBUNTU_ISO")" && grep " \*$NAME\$" "$WORK/SHA256SUMS" | sha256sum -c --quiet -) || die "La ISO descargada está corrupta: bórrala y repite"
fi
[ -f "$UBUNTU_ISO" ] || die "No existe $UBUNTU_ISO"

# ------------------------------------------------------------ contraseña
GENERATED=0
if [ -z "$PASSWORD" ]; then PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16); GENERATED=1; fi
HASH=$(openssl passwd -6 "$PASSWORD")

# ------------------------------------------------------------ CloudPlay dentro de la ISO
say "Empaquetando CloudPlay"
mkdir -p "$WORK/overlay/cloudplay" "$WORK/overlay/nocloud"
tar -C "$REPO" --exclude='./.git' --exclude='./.env' --exclude='./dist' --exclude='./landing/node_modules' \
    --exclude='./landing/.next' --exclude='./landing/out' --exclude='./worker/worker.env' --exclude='./worker/.env' \
    --exclude='*/__pycache__' --exclude='./control-plane/*.db' --exclude='./tests/e2e/*.png' --exclude='./tests/e2e/*.log' \
    --exclude='*.iso' -czf "$WORK/overlay/cloudplay/cloudplay.tar.gz" .
printf '%q ' "${PASS[@]}" > "$WORK/overlay/cloudplay/install.args"

# ------------------------------------------------------------ autoinstall (cloud-init NoCloud)
SSH_BLOCK="    install-server: true
    allow-pw: true"
if [ -n "$SSH_KEY" ]; then
  [ -f "$SSH_KEY" ] || die "No existe $SSH_KEY"
  SSH_BLOCK="    install-server: true
    allow-pw: false
    authorized-keys:
      - $(cat "$SSH_KEY")"
fi

cat > "$WORK/overlay/nocloud/meta-data" <<EOF
instance-id: cloudplay-$ROLE
EOF

cat > "$WORK/overlay/nocloud/user-data" <<EOF
#cloud-config
autoinstall:
  version: 1
  locale: es_ES.UTF-8
  keyboard:
    layout: $KB
  timezone: $TZ_
  identity:
    hostname: $HOSTNAME_
    realname: CloudPlay
    username: $USER_
    password: "$HASH"
  ssh:
$SSH_BLOCK
  storage:
    layout:
      name: lvm
      sizing-policy: all
  packages:
    - curl
    - jq
    - rsync
    - pciutils
  late-commands:
    - mkdir -p /target/opt/cloudplay-src /target/etc/cloudplay
    - tar -xzf /cdrom/cloudplay/cloudplay.tar.gz -C /target/opt/cloudplay-src
    - install -m 600 /cdrom/cloudplay/install.args /target/etc/cloudplay/firstboot.args
    - install -m 644 /target/opt/cloudplay-src/deploy/iso/cloudplay-firstboot.service /target/etc/systemd/system/cloudplay-firstboot.service
    - install -m 755 /target/opt/cloudplay-src/deploy/iso/99-cloudplay /target/etc/update-motd.d/99-cloudplay
    - curtin in-target --target=/target -- systemctl enable cloudplay-firstboot.service
  shutdown: reboot
EOF

# ------------------------------------------------------------ menú de arranque
say "Menú de arranque"
xorriso -osirrox on -indev "$UBUNTU_ISO" -extract /boot/grub/grub.cfg "$WORK/grub.orig.cfg" 2>/dev/null
chmod u+w "$WORK/grub.orig.cfg"
KERNEL=$(grep -m1 -E '^\s*linux\s' "$WORK/grub.orig.cfg" | awk '{print $2}')
INITRD=$(grep -m1 -E '^\s*initrd\s' "$WORK/grub.orig.cfg" | awk '{print $2}')
[ -n "$KERNEL" ] && [ -n "$INITRD" ] || die "No reconozco el grub.cfg de esta ISO"
AUTO=""
[ "$UNATTENDED" = 1 ] && AUTO="autoinstall "
{
  echo "set timeout=8"
  echo "set default=0"
  echo "loadfont unicode"
  echo "set menu_color_normal=white/black"
  echo "set menu_color_highlight=black/light-gray"
  echo
  echo "menuentry \"Instalar CloudPlay ($ROLE) — BORRA EL DISCO\" {"
  echo "    set gfxpayload=keep"
  echo "    linux $KERNEL ${AUTO}ds=nocloud\\;s=/cdrom/nocloud/ ---"
  echo "    initrd $INITRD"
  echo "}"
  echo
  # Deja el menú original de Ubuntu debajo (instalación normal, comprobar disco...)
  grep -v -E '^\s*set (timeout|default)=' "$WORK/grub.orig.cfg"
} > "$WORK/grub.cfg"

# ------------------------------------------------------------ ISO final
say "Generando $OUT"
rm -f "$OUT"
xorriso -indev "$UBUNTU_ISO" -outdev "$OUT" \
  -map "$WORK/overlay/nocloud" /nocloud \
  -map "$WORK/overlay/cloudplay" /cloudplay \
  -map "$WORK/grub.cfg" /boot/grub/grub.cfg \
  -boot_image any replay >/dev/null 2>"$WORK/xorriso.log" || { cat "$WORK/xorriso.log" >&2; die "xorriso falló"; }

CRED="${OUT%.iso}-acceso.txt"
(
  umask 077
  {
    echo "ISO: $OUT ($ROLE)"
    echo "Usuario: $USER_"
    if [ "$GENERATED" = 1 ]; then echo "Contraseña: $PASSWORD"; else echo "Contraseña: la que indicaste"; fi
    echo "Hostname: $HOSTNAME_"
  } > "$CRED"
)
ok "ISO lista: $OUT ($(du -h "$OUT" | cut -f1))"
ok "Acceso a la máquina en $CRED"
echo
echo "Paso 2: arranca el servidor con la ISO (USB con dd/Rufus/Ventoy, o súbela a Proxmox/VMware)."
if [ "$UNATTENDED" = 1 ]; then
  echo "        Se instala sola sin preguntar: ¡borra el disco de la máquina que arranque con ella!"
else
  echo "        El instalador pide una única confirmación («yes») antes de borrar el disco."
fi
