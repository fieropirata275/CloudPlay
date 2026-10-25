#!/usr/bin/env bash
# Genera las configuraciones de PCSX2 y Dolphin a partir de las plantillas (como uid 1000).
set -euo pipefail
T=/opt/cloudplay/templates
UPSCALE="${UPSCALE:-2}"

# ---------- PCSX2 ----------
PS2_BIOS="${PS2_BIOS:-}"
if [ -z "$PS2_BIOS" ] && [ -d /bios/ps2 ]; then
  PS2_BIOS="$(find /bios/ps2 -maxdepth 1 -type f -iname '*.bin' -printf '%f\n' | sort | head -n1 || true)"
fi
mkdir -p "$HOME/.config/PCSX2/inis"
sed -e "s|@PS2_BIOS@|${PS2_BIOS}|g" -e "s|@UPSCALE@|${UPSCALE}|g" \
  "$T/PCSX2.ini" > "$HOME/.config/PCSX2/inis/PCSX2.ini"

# ---------- Dolphin (directorio de usuario propio con -u) ----------
D="$HOME/.dolphin"
mkdir -p "$D/Config"
for f in Dolphin.ini GFX.ini GCPadNew.ini WiimoteNew.ini Hotkeys.ini; do
  sed -e "s|@UPSCALE@|${UPSCALE}|g" "$T/dolphin/$f" > "$D/Config/$f"
done
# Las partidas viven en /saves (persistidas por el agente)
for sub in GC Wii StateSaves; do
  rm -rf "${D:?}/$sub"
  ln -s "/saves/dolphin/$sub" "$D/$sub"
done
