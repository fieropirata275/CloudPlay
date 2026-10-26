# Arquitectura

```mermaid
flowchart LR
  subgraph Clientes
    A[Android / Android TV<br/>Kotlin + libwebrtc]
    W[Web / PWA]
    T[Samsung Tizen<br/>LG webOS]
  end

  subgraph CP[Control plane · docker compose]
    C[Caddy<br/>TLS + web]
    API[FastAPI<br/>auth · catálogo · sesiones<br/>scheduler · señalización]
    PG[(Postgres)]
    R[(Redis<br/>pub/sub · device codes)]
    S3[(S3 SeaweedFS<br/>partidas)]
    TURN[coturn]
  end

  subgraph N[Nodo worker · N máquinas con GPU]
    AG[Agente]
    subgraph S[Contenedor por sesión]
      X[Xvfb + VirtualGL]
      E[PCSX2 / Dolphin]
      P[PulseAudio]
      ST[session.py<br/>GStreamer webrtcbin<br/>NVENC · VA-API · x264]
      U[uinput<br/>Xbox 360 virtual]
    end
  end

  A & W & T -- HTTPS / WSS --> C --> API
  API --- PG & R
  AG -- WSS /ws/agent --> API
  AG -- docker.sock --> S
  AG -- partidas --> S3
  ST -- WSS /ws/signal --> API
  A & W & T == WebRTC  vídeo H.264 · audio Opus · input ==> ST
  A & W & T -. relay si hay NAT .-> TURN -.-> ST
  E --> X --> ST
  E --> P --> ST
  ST --> U --> E
```

## Flujo de una partida

```mermaid
sequenceDiagram
  participant C as Cliente
  participant API as Control plane
  participant AG as Agente
  participant S as Sesión (contenedor)
  C->>API: POST /api/sessions {game_id}
  API->>API: scheduler: nodo online con menos carga<br/>(lock advisory en Postgres)<br/>si no hay hueco: cola FIFO + dispatcher cada 2 s
  API-->>AG: start (vía Redis node:{id})
  API-->>C: {signal_url, ice_servers}
  AG->>AG: baja partidas del S3
  AG->>S: docker run (GPU, uinput, slot de puertos/display)
  AG-->>API: session_state running
  C->>API: WS /ws/signal ?role=client
  S->>API: WS /ws/signal ?role=worker
  API-->>S: peer-joined(client)
  S->>C: offer (H.264 + Opus + datachannels)
  C->>S: answer + ICE
  C-)S: input 16 B por cambio (datachannel unordered)
  S-)C: vídeo/audio RTP
  C->>API: DELETE /api/sessions/{id}
  API-->>AG: stop
  AG->>S: docker stop (el emulador vuelca memcards)
  AG->>AG: sube partidas al S3
  AG-->>API: session_state ended
```

## Decisiones

**WebRTC con el worker como offerer.** Mínima latencia (UDP, sin buffer de reproducción), NAT
traversal estándar y decodificación por hardware gratis en navegadores, Android y teles. El worker
ofrece `sendonly` para que el cliente solo tenga que contestar.

**Un contenedor por sesión.** Aislamiento entre usuarios, límites de CPU/RAM por sesión, y limpieza
trivial (el contenedor muere y no deja rastro). El agente es lo único que habla con Docker.

**`network_mode: host` en las sesiones.** WebRTC sin el NAT de Docker (menos latencia y sin
romper ICE). Cada slot recibe su propio rango de puertos ICE (`ICE_PORT_BASE + slot*20`) y su display
X (`:100+slot`), y Xvfb arranca sin socket abstracto para no colisionar entre sesiones.

**Input como estado, no eventos.** Por un canal sin orden ni retransmisiones: un paquete perdido no
añade latencia ni deja botones pegados.

**Mando virtual Xbox 360 vía uinput.** SDL2 (que usan PCSX2 y Dolphin) lo reconoce sin
configuración. Sin udev dentro del contenedor, `session.py` crea el nodo `/dev/input/eventN` con
mknod como root y después baja a uid 1000 **antes** de abrir red o lanzar el emulador.

**VirtualGL con backend EGL.** OpenGL acelerado por la GPU dentro de Xvfb sin servidor X real ni
monitor. Por eso los perfiles usan el renderer OpenGL de PCSX2 y Dolphin.

**Device code para teles.** Escribir contraseñas con el mando de la tele es un infierno: la tele
muestra un código y lo apruebas desde el móvil en `/#/link`.

**Pipeline nuevo por cada cliente.** El emulador sigue corriendo; reconectar o cambiar de dispositivo
solo reconstruye el pipeline de GStreamer y renegocia.

**Cola en lugar de "vuelve más tarde".** Si no hay hueco, la partida espera en una cola FIFO por
plataforma; un dispatcher (una sola réplica a la vez, lock en Redis) la coloca en cuanto un nodo
queda libre y avisa al cliente de su posición por la señalización.

**Animación con fallback.** El cliente web usa Motion (motion.dev) para la UI y GSAP + MorphSVG para
las siluetas de la pantalla de arranque. Ambas se sirven en local (las apps de TV no dependen de un
CDN), Motion se compila a Chrome 68 y, si alguna no carga o el usuario pide menos movimiento, la
interfaz funciona igual sin animar.

## Seguridad

- Contenedores de sesión: `cap_drop: ALL` + solo `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, MKNOD`,
  `no-new-privileges`, límites de memoria/CPU/PIDs, ROMs y BIOS montados de solo lectura.
- `session.py` baja a uid 1000 antes de tocar la red; el emulador nunca corre como root.
- Tokens: JWT para usuarios, token por nodo (`id.secret`, guardado como SHA-256), token por sesión
  para el worker, TURN con credenciales efímeras HMAC (caducan a las 6 h).
- coturn bloquea relays hacia redes privadas salvo la subred de workers que permitas.

### Límites conocidos

- La regla de cgroup `c 13:* rmw` permite a un contenedor abrir *cualquier* nodo de input si lo crea
  con mknod. El riesgo práctico es bajo (solo corre el emulador, sin root), pero si necesitas
  aislamiento duro, sustituye uinput por un interposer `LD_PRELOAD` de joystick como hace Selkies.
- `network_mode: host` comparte la red del nodo con las sesiones: dedica las máquinas worker solo a esto.
- Esquema de BD con `create_all` (sin migraciones). Antes de producción, mete Alembic.
