Librerías de terceros servidas en local (las apps de TV no dependen de CDNs). Regenerar con `scripts/vendor.sh`.

- `gsap.min.js`, `MorphSVGPlugin.min.js`, `Flip.min.js`, `SplitText.min.js` — GSAP 3.15.0, licencia estándar "no charge" (https://gsap.com/standard-license)
- `motion.min.js` — Motion 14.6.0 (https://motion.dev, MIT), solo `animate/stagger/spring/hover/press/inView/scroll`, compilado a Chrome 68
- `cp-scene.min.js` — fondo 3D de la app (`scripts/scene/scene.js`) con las piezas justas de three.js 0.171 (MIT). Se carga después del primer pintado y nunca en las teles
