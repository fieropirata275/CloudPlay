# CloudPlay ☁️🎮

Infraestructura de **emulación de consolas en la nube** (PS2 · GameCube · Wii) que se juega en
**Android, Android TV, Samsung (Tizen), LG (webOS) y navegador** por WebRTC.

```
clientes ──WebRTC (H.264/Opus + input)──▶ nodos GPU (un contenedor por partida)
    └──────HTTPS/WSS──▶ control plane (API, scheduler, señalización, TURN, partidas)
```

| Carpeta | Qué es |
|---|---|
| `control-plane/` | API FastAPI: auth (+ login por código para teles), catálogo, sesiones, scheduler, señalización WebRTC, agentes |
| `worker/agent/` | Agente de nodo: alta automática, lanza/para contenedores de sesión, GPUs, slots, partidas guardadas en S3 con autoguardado, drenaje |
| `worker/session/` | Imagen de sesión: Xvfb + VirtualGL + PCSX2/Dolphin + streamer GStreamer (NVENC/VA-API/x264) + mando virtual uinput |
| `clients/web/` | Cliente web/PWA, navegable con mando y con el mando de la tele |
| `clients/tizen/`, `clients/webos/` | Empaquetado del cliente web para Samsung y LG |
| `landing/` | Web comercial en Next.js + Skiper UI + Motion (estática, con formulario de demo conectado al panel) |
| `clients/android/` | App nativa Kotlin (móvil + Android TV) con WebRTC nativo y controles táctiles |
| `scripts/vendor.sh` | Regenera las librerías de animación servidas en local |
| `deploy/` | Instalador, ISO, Proxmox, Helm, n8n, marca de arranque · [guía](docs/DEPLOY.md) |
| `docs/` | [Despliegue](docs/DEPLOY.md) · [Arquitectura](docs/ARCHITECTURE.md) · [Protocolos](docs/PROTOCOL.md) |
| `tests/e2e/` | Prueba de extremo a extremo con Chromium headless, sin GPU ni Docker |

### Qué ofrece

- **Cola de espera** con posición en vivo cuando todos los nodos están llenos (FIFO por plataforma).
- **Favoritos** y **jugados hace poco**, búsqueda y filtro por plataforma.
- **Pantalla de arranque animada**: la nube se transforma (GSAP MorphSVG) en la silueta de la consola
  mientras avanza *cola → encendiendo → conectando → a jugar*. Interfaz con Motion (motion.dev):
  muelles al navegar con mando, transiciones de menú y avisos. Respeta "reducir movimiento".
- **Panel NOC** en `/#/admin`: nodos con carga y último latido, partidas en curso y en cola,
  fallos de las últimas 24 h y cierre forzado de partidas.
- **Login en la tele con código** aprobado desde el móvil, y salto de partida entre dispositivos.
- **Más animación en el cliente** sin romper las teles: la cuadrícula se reordena con GSAP Flip al filtrar o buscar,
  la carátula pulsada vuela hasta la pantalla de arranque, titulares letra a letra con SplitText y muelles de
  Motion al pasar el ratón o pulsar.
- **Capa de movimiento de la app**:
  - Fondo 3D con three.js que se tiñe con la plataforma y entra en "warp" mientras arranca la consola; se apaga y se pausa en cuanto hay vídeo. No se carga en teles (`?fx=full` lo fuerza, `?fx=lite` lo quita).
  - Un anillo de foco ámbar que viaja con muelle entre elementos al navegar con mando, teclado o mando de la tele.
  - Transiciones entre pantallas, barra superior que se condensa con el scroll (con barra de progreso de Motion `scroll`), carátulas que aparecen con `inView`, inclinación con reflejo al pasar el ratón.
  - Código de la tele tipo split-flap, palabra que rota en el login, menú y panel con entrada en cascada, pista de arranque que se llena por pasos.
  - Efectos inspirados en Skiper UI portados a JS sin React: texto que rueda, desenfoque progresivo y palabra rotatoria.
- **Web comercial** (`landing/`) con solicitudes de demo que llegan al panel del NOC.

> ⚖️ Solo ROMs y BIOS volcadas de juegos y consolas que poseas. Ofrecer juegos comerciales a
> terceros (clientes de pago incluidos) requiere licencias de los titulares de los derechos.

---

## 1. Despliegue en 2 pasos

**👉 Guía completa: [docs/DEPLOY.md](docs/DEPLOY.md)** — ISO de Ubuntu que se instala sola, un comando en un
Ubuntu existente, plantillas de Proxmox, Helm para Kubernetes, autoescalado con n8n y Cloudflare Tunnel.

```bash
# Orquestador (master), publicado con Cloudflare Tunnel y vídeo por el TURN de Cloudflare: sin abrir puertos
curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | sudo bash -s -- \
  orchestrator --domain play.empresa.com --tunnel-token <TOKEN> --cf-turn-key-id <KEY_ID> --cf-turn-token <API_TOKEN>

# Nodo gaming (slave), en cada máquina con GPU: se da de alta solo
curl -fsSL https://github.com/fieropirata275/cloudplay/releases/latest/download/get.sh | sudo bash -s -- \
  node --cp-url https://play.empresa.com --join-token <TOKEN_DE_UNIÓN>
```

Todo se descarga de GitHub: el código de la última **Release** (verificado con SHA256) y las imágenes ya
compiladas de **GHCR** (`ghcr.io/fieropirata275/cloudplay-{control-plane,agent,session,web}`), así que no se
compila nada en el servidor. Otros modos del mismo comando:

| Modo | Ejemplo |
|---|---|
| Orquestador + nodo en una máquina | `… \| sudo bash -s -- all --domain play.empresa.com` |
| Proxmox (en el host) | `… \| sudo bash -s -- proxmox node-template --cp-url https://play.empresa.com --join-token T` |
| ISO autoinstalable | `… \| sudo bash -s -- iso --role node --cp-url https://play.empresa.com --join-token T` |
| Kubernetes (Helm) | `… \| bash -s -- helm --domain play.empresa.com --tunnel-token T` |
| Versión concreta | `curl … \| sudo CLOUDPLAY_VERSION=v1.0.0 bash -s -- orchestrator …` |

Actualizar sin cortes a la última versión publicada: `sudo cloudplay update`.

| Carpeta | Para qué |
|---|---|
| `deploy/install/` | Instalador para Ubuntu 22.04/24.04 y el comando `cloudplay` (estado, actualizaciones sin cortes, copias, túnel, drenaje) |
| `deploy/iso/` | `build-iso.sh`: ISO de Ubuntu 24.04 con autoinstalación y CloudPlay en el primer arranque |
| `deploy/proxmox/` | Plantilla de nodo con cloud-init, clones con GPU en passthrough, retirada sin cortes |
| `deploy/helm/cloudplay/` | Chart de Kubernetes (HA, rolling updates, PDB, cloudflared, DaemonSet de nodos opcional) |
| `deploy/n8n/` | Workflow de autoescalado en Proxmox (sube con cola, drena y apaga lo que sobra) |
| `deploy/branding/` | Animación de arranque (Plymouth) que identifica orquestador / nodo gaming |

Instalación manual (sin el instalador): `cp .env.example .env && docker compose up -d --build` en el orquestador,
y en cada nodo `cd worker && docker build -t cloudplay/session:local ./session && cp worker.env.example worker.env
&& docker compose up -d --build` con `JOIN_TOKEN` y `CP_URL` rellenos. Los juegos van en
`/srv/cloudplay/library/{ps2,gc,wii}` (se dan de alta solos) y el firmware en `/srv/cloudplay/bios/` (BIOS de PS2,
IPL de GameCube y NAND de Wii). Con el firmware, el catálogo también ofrece **la consola sin juego** (navegador de la PS2,
menú principal de GameCube, Wii Menu): ver [docs/DEPLOY.md](docs/DEPLOY.md#juegos-bios-y-consolas-sin-juego).

### Web comercial

```bash
cd landing && npm ci
NEXT_PUBLIC_SITE_URL=https://$LANDING_DOMAIN npm run build
docker compose up -d caddy      # sirve landing/out en LANDING_DOMAIN
```
(o `--with-landing` en el instalador)

## 2. Requisitos de los nodos gaming

- **NVIDIA**: el instalador pone el driver y nvidia-container-toolkit → NVENC
- **Intel/AMD**: `/dev/dri` → VA-API
- Sin GPU: render y codificación por CPU (solo para pruebas)

### Dimensionado orientativo (mídelo con tus juegos)

| | PS2 (PCSX2, 2× nativo) | GC/Wii (Dolphin, 2×) |
|---|---|---|
| CPU por sesión | 2-3 núcleos rápidos | 3-4 núcleos rápidos (CPU thread) |
| RAM por sesión | ~2 GB | ~3 GB |
| Ancho de banda | 6-12 Mbps a 720p60 | 6-12 Mbps a 720p60 |

Las GeForce limitan las sesiones NVENC simultáneas (consulta la tabla de NVIDIA para tu driver);
las Quadro/RTX Ax000 no. Dolphin depende mucho del rendimiento por núcleo.

## 3. Clientes

- **Favoritos**: Y en el mando, F en el teclado, botón amarillo de la tele o la estrella de la carátula
  (en Android: pulsación larga o Y).
- **Web**: `https://TU_DOMINIO` (instalable como PWA). Teclado: flechas, X=A, Z=B, S=X, A=Y, Q/W=LB/RB, 1/2=LT/RT, Enter=Start, Shift=Select, Esc=menú.
- **Tele (Tizen/webOS)**: la app muestra un código → en el móvil entra en `https://TU_DOMINIO/#/link`.
  ```bash
  clients/tizen/build.sh https://TU_DOMINIO [perfil-certificado]   # Tizen Studio CLI
  clients/webos/build.sh https://TU_DOMINIO                        # npm i -g @webos-tools/cli
  ```
  Mando de la tele: flechas, OK=A, 1=B, 2=Select, 3/Play=Start, colores=X/Y/LB/RB, Atrás=menú.
  Para jugar en serio, un mando Bluetooth (Gamepad API). WebRTC en las apps de TV depende del
  firmware: prueba en tus modelos (Tizen 2021+/webOS 6+ como referencia).
- **Android / Android TV** (una sola APK, aparece en el launcher de Android TV):
  ```bash
  cd clients/android
  ./gradlew assembleRelease -PcloudplayServer=https://TU_DOMINIO   # o ábrelo en Android Studio
  ```
  Mandos físicos (hasta 4 jugadores), mando de la tele y controles táctiles si no hay mando.

En partida: **Select+Start 1 s** (o Atrás/Esc) abre el menú: guardar/cargar estado, calidad,
estadísticas, configurar mando, salir sin cerrar (y seguir en otro dispositivo) o cerrar el juego.

### App de escritorio, Wiimote real y accesorios

- **App de escritorio** (Windows, macOS, Linux) en cada [Release](https://github.com/fieropirata275/CloudPlay/releases):
  el mismo cliente con los permisos resueltos, así el Wiimote, la Balance Board, el micro y la cámara funcionan
  nada más conectarlos. Código en `clients/desktop` (Electron); `npm start` para probarla.
- **Wiimote y Balance Board reales** del ordenador del jugador → Dolphin de la nube (puente HID con una libhidapi
  propia, sin módulos del kernel). Puntero, altavoz, vibración, MotionPlus y extensiones.
- **Micro y cámara** del jugador como micros de SingStar, micro de GameCube o EyeToy.
- **Accesorios**: Buzz!, guitarra, batería, GunCon 2, teclado y ratón USB (PS2); bongos, alfombra, micro y teclado (GameCube).
- **Animaciones** de mando conectado / desconectado con el estilo de cada consola (web, teles y Android).

Guía para jugadores: [docs/MANDOS.md](docs/MANDOS.md).

### Mandos originales (PS2, GameCube) y cualquier mando USB

Los mandos de PS2 y GameCube se conectan al ordenador, tele o Android con su adaptador USB (Mayflash, Super Dual Box,
adaptadores genéricos de PS2…). CloudPlay los traduce al mando que esperan los emuladores:

1. **Perfil automático**: ~860 mandos y adaptadores reconocidos por su USB, sacados de
   [SDL_GameControllerDB](https://github.com/mdqinc/SDL_GameControllerDB) (`tools/gen-padsdb.py` → `clients/web/js/padsdb.js`,
   se carga solo cuando se conecta un mando que el navegador no reconoce).
2. **Asistente «Configurar mando»** (web, teles y Android): eliges qué mando es (PS2, GameCube u otro) y pulsas cada
   botón cuando te lo pide, con su nombre de verdad (✕ ◯ □ △, A B X Y Z…). Queda guardado en ese dispositivo para ese
   modelo de mando. En la web está en **Mandos** (biblioteca) con **prueba en vivo** de botones, sticks y gatillos.
3. Si se conecta un mando desconocido, la app ofrece configurarlo.

Límites: los botones sensibles a la presión del DualShock 2 llegan como normales (casi ningún adaptador los manda) y el
adaptador oficial de Nintendo para GameCube no aparece como mando en Windows (necesitaría su driver aparte). El resto,
en [docs/MANDOS.md](docs/MANDOS.md#límites-conocidos).

## 4. Desarrollo y pruebas

```bash
# API + UI sin Docker (SQLite + Redis en memoria + juegos de ejemplo)
cd control-plane && pip install -r requirements.txt aiosqlite fakeredis
python devserver.py                      # http://localhost:8000 · admin@local / devpassword

# Tests
cd control-plane && pytest -q            # flujo completo de API, agente, señalización, device code, TURN
cd worker/session && Xvfb :99 & DISPLAY=:99 python3 tests/loopback_test.py   # streamer WebRTC real
cd tests/e2e && ./run.sh                 # navegador real jugando contra session.py
cd clients/android && ./gradlew testDebugUnitTest   # protocolo + asistente de mandos
node tests/web/pads.test.js              # mapeo de mandos web (perfiles SDL, hat, asistente, Buzz!)
python -m pytest worker/session/tests/test_hidbridge.py   # puente HID del Wiimote
tests/wii/run.sh cloudplay/session:local # Dolphin de verdad conectando un Wiimote y una Balance Board simulados
cd tests/e2e && E2E_WII=1 ./run.sh       # (también E2E_MEDIA, E2E_ACC, E2E_DESKTOP) navegador/app -> nube
```

Qué está verificado y qué no: ver [la sección de verificación](#verificación).

## Verificación

Probado en este repo:
- Control plane: tests de extremo a extremo (login, device code, alta de nodo, autocatálogo,
  scheduler y capacidad, cola y salida de cola, favoritos y recientes, panel admin, relay de
  señalización, fin de sesión, credenciales TURN).
- Streamer: loopback WebRTC real con GStreamer (offer, ICE, vídeo H.264 decodificado, canales de datos).
- E2E en Chromium: el cliente web juega contra `session.py` real: fases de arranque, vídeo
  1280×720 a 60 fps, input del teclado llegando al worker, menú, guardar estado, cierre de sesión y
  la partida apareciendo en "jugados hace poco".
- Protocolo de input idéntico byte a byte en JS, Kotlin y Python.
- APK de Android compila y pasa los tests unitarios.

Pendiente de probar en tu hardware (aquí no hay GPU ni Docker):
- Imagen de sesión con PCSX2/Dolphin reales, NVENC/VA-API y VirtualGL.
- Mapeos de mando de los `.ini`: si algo no cuadra, configúralo una vez en la GUI del emulador
  y copia las claves a `worker/session/templates/`.
- Apps de Tizen/webOS y la APK en dispositivos reales.
