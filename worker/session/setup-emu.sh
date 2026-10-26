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

# ---------- Firmware de GameCube y Wii (para arrancar la consola sin juego) ----------
# IPL de GameCube: /bios/gc/{EUR,USA,JAP}/IPL.bin → enlace en la carpeta de Dolphin (no se copia a las partidas)
for r in EUR USA JAP; do
  if [ -f "/bios/gc/$r/IPL.bin" ]; then
    mkdir -p "$D/GC/$r" && ln -sfn "/bios/gc/$r/IPL.bin" "$D/GC/$r/IPL.bin"
  fi
done
# NAND de Wii (carpeta "Wii" de Dolphin con el System Menu): el contenido de los títulos se enlaza en solo
# lectura (no engorda las partidas de cada usuario) y los datos pequeños (ajustes, Mii, tickets) se copian
# una vez para que cada usuario tenga los suyos.
W=/bios/wii
if [ -d "$W/title" ]; then
  for t in "$W"/title/*/*; do
    [ -d "$t" ] || continue
    dst="$D/Wii/title/${t#"$W"/title/}"
    mkdir -p "$dst"
    [ -d "$t/content" ] && [ ! -e "$dst/content" ] && ln -s "$t/content" "$dst/content"
    [ -d "$t/data" ] && cp -rn "$t/data" "$dst/" 2>/dev/null
  done
  [ -d "$W/shared1" ] && [ ! -e "$D/Wii/shared1" ] && ln -s "$W/shared1" "$D/Wii/shared1"
  for x in "$W"/*; do
    case "${x##*/}" in title|shared1) continue ;; esac
    cp -rn "$x" "$D/Wii/" 2>/dev/null
  done
fi
true
