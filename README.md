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
| `worker/agent/` | Agente de nodo: lanza/para contenedores de sesión, GPUs, slots, partidas en MinIO, autocatálogo |
| `worker/session/` | Imagen de sesión: Xvfb + VirtualGL + PCSX2/Dolphin + streamer GStreamer (NVENC/VA-API/x264) + mando virtual uinput |
| `clients/web/` | Cliente web/PWA, navegable con mando y con el mando de la tele |
| `clients/tizen/`, `clients/webos/` | Empaquetado del cliente web para Samsung y LG |
| `landing/` | Web comercial en Next.js + Skiper UI + Motion (estática, con formulario de demo conectado al panel) |
| `clients/android/` | App nativa Kotlin (móvil + Android TV) con WebRTC nativo y controles táctiles |
| `scripts/vendor.sh` | Regenera las librerías de animación servidas en local |
| `docs/` | [Arquitectura](docs/ARCHITECTURE.md) · [Protocolos](docs/PROTOCOL.md) |
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

## 1. Control plane (1 VPS o máquina)

Requisitos: Docker + Compose, un dominio apuntando a la máquina, puertos abiertos:
TCP 80/443, TCP/UDP 3478, TCP 5349, UDP 49160-49400 (relay TURN).

```bash
cp .env.example .env          # rellena dominio, IP pública y secretos (openssl rand -base64 48)
docker compose up -d --build
```

Caddy saca el certificado solo. El admin de `.env` se crea al arrancar.
Alta de un nodo (guarda el token, no se vuelve a mostrar):

```bash
docker compose exec api python -m app.cli create-node --name gpu-01 --capacity 4 --platforms ps2,gc,wii
docker compose exec api python -m app.cli create-user --email jugador@ejemplo.com --password 'xxxxxxxx'
```

### Web comercial

```bash
cd landing && npm ci
NEXT_PUBLIC_SITE_URL=https://$LANDING_DOMAIN npm run build
docker compose up -d caddy      # sirve landing/out en LANDING_DOMAIN
```

## 2. Nodo worker (cada máquina con GPU)

Requisitos: Linux + Docker, módulo `uinput`, y según la GPU:
- **NVIDIA**: driver + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/) → `GPU=nvidia` (NVENC)
- **Intel/AMD**: `/dev/dri` → `GPU=vaapi`
- Sin GPU: `GPU=cpu` (x264 + render por software, solo para pruebas)

```bash
sudo modprobe uinput && echo uinput | sudo tee /etc/modules-load.d/uinput.conf

# Librería: una carpeta por plataforma. Los juegos se dan de alta solos al conectar el agente.
sudo mkdir -p /srv/cloudplay/library/{ps2,gc,wii} /srv/cloudplay/bios/ps2
#   ps2/  .iso .chd .cso    gc/  .iso .rvz .gcm .ciso    wii/  .wbfs .rvz .iso
#   bios/ps2/  tu BIOS volcada (scphXXXXX.bin) — GameCube y Wii no la necesitan

cd worker
docker build -t cloudplay/session:latest ./session
cp worker.env.example worker.env    # CP_URL, NODE_TOKEN, GPU, MinIO...
docker compose up -d --build
```

Firewall del worker: UDP `ICE_PORT_BASE` … `ICE_PORT_BASE + CAPACITY*20` (por defecto 40000-40079 con 4 slots).
Si los workers están en una LAN privada, MinIO y la API tienen que ser alcanzables desde ellos
(VPN tipo WireGuard/Tailscale recomendada) y añade su subred a `allowed-peer-ip` en coturn.

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
estadísticas, salir sin cerrar (y seguir en otro dispositivo) o cerrar el juego.

## 4. Desarrollo y pruebas

```bash
# API + UI sin Docker (SQLite + Redis en memoria + juegos de ejemplo)
cd control-plane && pip install -r requirements.txt aiosqlite fakeredis
python devserver.py                      # http://localhost:8000 · admin@local / devpassword

# Tests
cd control-plane && pytest -q            # flujo completo de API, agente, señalización, device code, TURN
cd worker/session && Xvfb :99 & DISPLAY=:99 python3 tests/loopback_test.py   # streamer WebRTC real
cd tests/e2e && ./run.sh                 # navegador real jugando contra session.py
cd clients/android && ./gradlew testDebugUnitTest
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
