#!/usr/bin/env bash
# Regenera clients/web/vendor: GSAP + MorphSVG (licencia "no charge" de GSAP, todos los plugins gratis)
# y un build mínimo de Motion (motion.dev) bajado a Chrome 68 para las teles Tizen/webOS antiguas.
set -euo pipefail
GSAP=3.15.0; MOTION=14.6.0
OUT="$(cd "$(dirname "$0")/.." && pwd)/clients/web/vendor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP" && npm init -y >/dev/null
npm install -s "gsap@$GSAP" "motion@$MOTION" esbuild
cp node_modules/gsap/dist/gsap.min.js node_modules/gsap/dist/MorphSVGPlugin.min.js "$OUT/"
echo 'export { animate, stagger, spring, hover, press } from "motion";' > entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=Motion --target=chrome68 \
  --legal-comments=none --outfile="$OUT/motion.min.js"
echo "vendor listo en $OUT"
