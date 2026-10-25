# CloudPlay · landing comercial

Next.js 16 (App Router) + Tailwind 4 + shadcn + **Skiper UI** + **Motion** (`framer-motion`), exportada a estático.

```bash
npm ci
NEXT_PUBLIC_SITE_URL=https://www.tu-dominio.com \
npm run build            # genera out/, que sirve Caddy (ver deploy/caddy/Caddyfile)
npm run dev              # desarrollo en http://localhost:3000
```

- `NEXT_PUBLIC_API_URL` (opcional): control plane al que el formulario envía `POST /api/leads`. Si no se pone, se envía
  al mismo dominio y Caddy reenvía solo ese endpoint a la API. Las solicitudes aparecen en el panel `/#/admin`.
- `NEXT_PUBLIC_SITE_URL`: URL pública de la landing (imágenes de Open Graph).

## Componentes de Skiper UI usados

Instalados con `npx shadcn add @skiper-ui/<nombre>` en `components/ui/skiper-ui/` (son copias editables):

| Componente | Dónde | Cambio local |
|---|---|---|
| skiper41 `ProgressiveBlur` | Desenfoque bajo la barra de navegación | — |
| skiper58 `TextRoll` | Enlaces del menú | Espacios → espacios de no separación (los colapsa) |
| skiper67 `VideoPlayer…` | Spot del hero: "Ver el spot" sigue al cursor y abre el modal con clip-path | — |
| skiper31 `CharacterV1` | "Sin consola. Sin descargas. Sin cables." se ensambla con el scroll | Prop `className` (venía en naranja fijo) |
| skiper16 `StickyCard_001` | Los 4 pasos de "Cómo funciona" se apilan | Props `className` y `children` |
| skiper47 `Carousel_001` | Carrusel de capturas reales | Estilos en `globals.css` |
| skiper52 `HoverExpand_001` | Las tres consolas (en escritorio; en móvil, rejilla) | — |
| skiper37 (inspiración) | Cifras con NumberFlow al entrar en pantalla | Componente propio `Stats.tsx` |
| skiper19 `LinePath` | Trazo ámbar que se dibuja con el scroll en "Cómo funciona" | Exportado con props de color, grosor y tramo inicial |
| skiper28 `PerspectiveTextScroll` | "Mientras juegas, CloudPlay…" avanza en perspectiva | Contenido por props, sin Lenis propio |
| skiper30 `ParallaxGallery` | Galería de capturas en 4 columnas a distinta velocidad | Imágenes por props, sin Lenis propio |
| skiper40 `Link000` / `Link001` | Enlaces del pie con subrayado animado | `rel="noopener noreferrer"` en el externo |
| skiper61 `SpringMouseFollow` | Punto ámbar que sigue al ratón y crece sobre enlaces | Ventana completa; solo con ratón |
| skiper62 `useLoop` | La pantalla de destino rota en el texto del hero | — |

## Otras animaciones

- **three.js** (`HeroScene.tsx`): nube de 6.500 partículas que se transforma en siluetas genéricas (torre, cubo, placa) con el morph en el shader. Se carga en un chunk aparte, se pausa fuera de pantalla y con "reducir movimiento" queda quieta.
- **Motion** (`MotionKit.tsx` y secciones):
  - Intro de arranque (`Intro.tsx`): la nube se dibuja, se enciende el LED y sube la cortina. Una vez por sesión; se quita sola por CSS si falla el JS.
  - Navegación que se esconde al bajar y pastilla de sección activa con `layoutId`.
  - Hero con foco de luz que sigue al puntero, titular que se levanta en 3D y spot que pasa de inclinado a plano con el scroll.
  - Manifiesto que se enciende palabra a palabra (`Manifesto.tsx`).
  - Recorrido horizontal fijado "Del botón a la pantalla" con un paquete que viaja por 6 etapas (`Pipeline.tsx`).
  - Titulares con máscara (`RevealText`), tarjetas con borde iluminado (`SpotlightCard`), inclinación por velocidad de scroll (`SkewOnScroll`).
  - Cifras con parallax por columna, formulario con anillo de foco compartido, botón que se transforma en spinner y confeti al enviar.
  - Pie con el nombre gigante que se abre al llegar y botón magnético para volver arriba.
  - Barra de progreso de scroll, botones magnéticos, cinta que acelera con el scroll y captura del panel con inclinación 3D.
  - Todo respeta "reducir movimiento".

La versión gratuita de Skiper UI pide **atribución**: está en el pie de la página.
