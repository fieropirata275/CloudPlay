#!/usr/bin/env bash
# Regenera clients/web/vendor: GSAP + MorphSVG (licencia "no charge" de GSAP, todos los plugins gratis)
# y un build mínimo de Motion (motion.dev) bajado a Chrome 68 para las teles Tizen/webOS antiguas.
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
GSAP=3.15.0; MOTION=14.6.0; THREE=0.171.0
OUT="$(cd "$(dirname "$0")/.." && pwd)/clients/web/vendor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP" && npm init -y >/dev/null
npm install -s "gsap@$GSAP" "motion@$MOTION" "three@$THREE" esbuild
cp node_modules/gsap/dist/{gsap,MorphSVGPlugin,Flip,SplitText}.min.js "$OUT/"
echo 'export { animate, stagger, spring, hover, press, inView, scroll } from "motion";' > entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=Motion --target=chrome68 \
  --legal-comments=none --outfile="$OUT/motion.min.js"
# Fondo 3D de la app: solo las piezas de three.js que usa (se carga después, nunca en las teles)
cp "$SCRIPTS/scene/scene.js" "$TMP/scene.js"
npx esbuild scene.js --bundle --minify --format=iife --target=chrome68 \
  --legal-comments=none --outfile="$OUT/cp-scene.min.js"
echo "vendor listo en $OUT"
