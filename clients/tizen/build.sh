#!/usr/bin/env bash
# Empaqueta el cliente web como app Tizen (.wgt) para Samsung TV.
#   ./build.sh https://play.example.com [perfil-de-certificado]
# Requiere Tizen Studio CLI (tizen) en el PATH y un perfil de certificado Samsung creado en el Certificate Manager.
set -euo pipefail
SERVER="${1:?Uso: ./build.sh https://play.example.com [perfil]}"
PROFILE="${2:-CloudPlay}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r "$HERE/../web/." "$OUT/"
cp "$HERE/config.xml" "$HERE/icon.png" "$OUT/"
rm -f "$OUT/manifest.webmanifest"
printf 'window.CP_CONFIG = { server: "%s" };\n' "$SERVER" > "$OUT/js/config.js"
if command -v tizen >/dev/null; then
  tizen package -t wgt -s "$PROFILE" -- "$OUT"
  echo "Instalar en la tele (modo desarrollador activado):"
  echo "  sdb connect <IP_TV> && tizen install -n $OUT/CloudPlay.wgt -t <nombre_tv>"
else
  echo "Carpeta lista en $OUT (falta el CLI 'tizen' para generar el .wgt firmado)"
fi
