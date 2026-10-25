#!/usr/bin/env bash
# Empaqueta el cliente web como app webOS (.ipk) para LG TV.
#   ./build.sh https://play.example.com
# Requiere webOS CLI (npm i -g @webos-tools/cli -> comandos ares-*).
set -euo pipefail
SERVER="${1:?Uso: ./build.sh https://play.example.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
rm -rf "$OUT" && mkdir -p "$OUT/app"
cp -r "$HERE/../web/." "$OUT/app/"
cp "$HERE/appinfo.json" "$HERE/icon.png" "$HERE/largeIcon.png" "$OUT/app/"
rm -f "$OUT/app/manifest.webmanifest"
printf 'window.CP_CONFIG = { server: "%s" };\n' "$SERVER" > "$OUT/app/js/config.js"
if command -v ares-package >/dev/null; then
  ares-package "$OUT/app" -o "$OUT"
  echo "Instalar (Developer Mode app activa en la tele):"
  echo "  ares-setup-device  &&  ares-install -d <tv> $OUT/*.ipk  &&  ares-launch -d <tv> it.neurofix.cloudplay"
else
  echo "Carpeta lista en $OUT/app (falta 'ares-package' para generar el .ipk)"
fi
