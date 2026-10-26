#!/usr/bin/env bash
# Marca de CloudPlay en el arranque de la máquina:
#  · Tema de Plymouth animado que dice si es el orquestador (MASTER), un nodo gaming (SLAVE) o ambos.
#  · Pantalla de bienvenida de la consola (/etc/issue) con el rol, la IP y la URL.
#  · Mensajes de los servicios de CloudPlay en la pantalla de arranque.
#   sudo deploy/branding/apply.sh orchestrator|node|all [dominio]
set -Eeuo pipefail
ROLE="$1" DOMAIN="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME=/usr/share/plymouth/themes/cloudplay
case "$ROLE" in
  orchestrator) MODE=master; LABEL="ORQUESTADOR · MASTER"; COLOR='1;33' ;;
  node) MODE=slave; LABEL="NODO GAMING · SLAVE"; COLOR='1;36' ;;
  all) MODE=all; LABEL="ORQUESTADOR + NODO GAMING"; COLOR='1;35' ;;
  *) echo "Uso: $0 orchestrator|node|all [dominio]" >&2; exit 2 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq plymouth plymouth-themes plymouth-label >/dev/null 2>&1 || apt-get install -y -qq plymouth plymouth-themes >/dev/null

# --- tema de Plymouth con las piezas del rol
rm -rf "$THEME"; mkdir -p "$THEME"
P="$HERE/plymouth"
cp "$P/logo.png" "$P/wordmark.png" "$P/bar-bg.png" "$P/bar-fill.png" "$P/cloudplay.plymouth" "$THEME/"
cp "$P/badge-$MODE.png" "$THEME/badge.png"
cp "$P/dot-$MODE.png" "$THEME/dot.png"
cp "$P/ring-$MODE.png" "$THEME/ring.png"
sed "s/@MODE@/$MODE/" "$P/cloudplay.script.in" > "$THEME/cloudplay.script"
update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "$THEME/cloudplay.plymouth" 200 >/dev/null
update-alternatives --set default.plymouth "$THEME/cloudplay.plymouth" >/dev/null
printf '[Daemon]\nTheme=cloudplay\nShowDelay=0\n' > /etc/plymouth/plymouthd.conf

# --- GRUB: splash gráfico también en VMs con consola serie (Proxmox, imágenes cloud)
if [ -d /etc/default/grub.d ] || [ -f /etc/default/grub ]; then
  mkdir -p /etc/default/grub.d
  cat > /etc/default/grub.d/99-cloudplay.cfg <<'GRUB'
# CloudPlay: animación de arranque
GRUB_CMDLINE_LINUX_DEFAULT="$GRUB_CMDLINE_LINUX_DEFAULT quiet splash plymouth.ignore-serial-consoles"
GRUB_TIMEOUT_STYLE=hidden
GRUB_TIMEOUT=2
GRUB
  command -v update-grub >/dev/null && update-grub >/dev/null 2>&1 || true
fi
update-initramfs -u >/dev/null 2>&1 || true

# --- servicios de CloudPlay: avisan en la pantalla de arranque
for svc in cloudplay cloudplay-node; do
  mkdir -p "/etc/systemd/system/$svc.service.d"
  if [ "$svc" = cloudplay ]; then a="Levantando el orquestador…"; b="Orquestador en marcha"; else a="Conectando con el orquestador…"; b="Nodo gaming listo para jugar"; fi
  cat > "/etc/systemd/system/$svc.service.d/plymouth.conf" <<UNIT
[Service]
ExecStartPre=-/usr/bin/plymouth display-message --text="$a"
ExecStartPost=-/usr/bin/plymouth display-message --text="$b"
UNIT
done
systemctl daemon-reload 2>/dev/null || true

# --- bienvenida de la consola (lo que se ve tras la animación)
ESC=$'\e'
{
  printf '\n'
  printf '  %s[38;5;99m   ▄██████▄   %s[0m\n' "$ESC" "$ESC"
  printf '  %s[38;5;99m ▄██████████▄ %s[0m  %s[1;37mCloudPlay%s[0m\n' "$ESC" "$ESC" "$ESC" "$ESC"
  printf '  %s[38;5;63m ▀██████████▀ %s[0m  %s[%sm%s%s[0m\n' "$ESC" "$ESC" "$ESC" "$COLOR" "$LABEL" "$ESC"
  printf '\n'
  printf '  Máquina: \\n   ·   IP: \\4\n'
  if [ -n "$DOMAIN" ]; then printf '  Plataforma: https://%s\n' "$DOMAIN"; fi
  printf '  Estado: sudo cloudplay status\n\n'
} > /etc/issue
echo "Marca de arranque aplicada ($LABEL)"
