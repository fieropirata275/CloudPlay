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

La versión gratuita de Skiper UI pide **atribución**: está en el pie de la página.
