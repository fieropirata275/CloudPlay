# Arranque "de firmware" de CloudPlay

`ps2.webm`, `gc.webm` y `wii.webm` son la animación que sale al encender cada consola, **por la señal de vídeo de la
consola**: `cloudplay/bootsplash.py` la pinta en el display virtual de la sesión (el mismo que captura el streamer), en
una ventana a pantalla completa que se queda por encima del emulador. Para el jugador es la pantalla de la consola,
como si trajera un firmware nuestro, en cualquier cliente.

```
cliente conectado (ICE) ──► animación (5,2 s, con sonido por la salida de audio de la consola)
                 a los 3 s ──► se enciende el emulador debajo (BIOS de Sony / IPL / juego)
          fin en negro ──► queda la consola
```

- Cualquier botón del mando la salta (la consola se enciende en ese momento).
- Si nadie se conecta en `BOOTSPLASH_WAIT` segundos, o falta el fichero, o algo falla: la consola se enciende sin más.
- Diseño propio: logo de CloudPlay en metal tintado (PS2 azul, GameCube morado, Wii plata) y siluetas genéricas de
  las consolas; no usa nada de los firmwares de Sony ni Nintendo.

## Variables de la sesión

| Variable | Por defecto | |
|---|---|---|
| `BOOTSPLASH` | `1` | `0` la quita |
| `BOOTSPLASH_LEAD` | `3.0` | segundos de animación antes de encender la consola |
| `BOOTSPLASH_WAIT` | `25` | espera máxima al primer cliente |
| `BOOTSPLASH_DIR` | `/opt/cloudplay/bootsplash` | carpeta con `<consola>.webm` |
| `BOOTSPLASH_AUDIO` | `pulsesink sync=true` | salida del sonido (GStreamer) |

## Volver a renderizarla

`studio/` es la fuente: `splash.html` (three.js: logo extruido de `fx.SHAPES.cloud`, metal físico con un estudio de
tiras de luz, disolución por shader y partículas que forman la silueta), `jingle.py` (sonido sintetizado) y
`render.mjs` (fotograma a fotograma con Chromium, 1280x720 a 60 fps, VP9 + Opus).

```bash
cd worker/session/bootsplash/studio && npm i && node render.mjs          # las tres
node render.mjs ps2 --stills                                            # 9 fotogramas de muestra
```

Prueba de extremo a extremo con el cliente web real: `E2E_BOOT=1 tests/e2e/run.sh` (imprime `BOOT_E2E_OK`).
