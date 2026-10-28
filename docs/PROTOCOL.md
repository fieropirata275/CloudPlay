# Protocolos

## 1. Señalización (WebSocket `/ws/signal/{session_id}`)

`?role=client&token=<JWT>` o `?role=worker&token=<worker_token>`. El control plane solo **reenvía**
mensajes entre los dos roles (vía Redis pub/sub, así funciona con varias réplicas de la API).

| Mensaje | Dirección | Cuerpo |
|---|---|---|
| `peer-joined` | servidor → ambos | `{role}` — al conectar, y al conectarse el otro |
| `peer-left` | servidor → ambos | `{role}` |
| `offer` | worker → cliente | `{sdp}` — el **worker** ofrece siempre (sendonly) |
| `answer` | cliente → worker | `{sdp}` |
| `ice` | ambos | `{candidate, sdpMLineIndex}` |
| `bye` | ambos | `{reason}` |
| `session-state` | servidor → cliente | `{status, error}` — `starting` al salir de la cola, `failed` / `ended` desde el agente |
| `queue` | servidor → cliente | `{position}` — cada 2 s mientras la partida espera hueco |

Códigos de cierre: `4403` sesión inexistente o token inválido · `4409` otra conexión del mismo rol
te ha sustituido (abriste la partida en otro dispositivo).

Cada `peer-joined` del cliente hace que el worker **reconstruya el pipeline** y mande una offer nueva:
así se puede saltar del móvil a la tele sin cerrar el juego.

### Cola de espera

`POST /api/sessions` devuelve **201** si hay hueco (estado `starting`) o **202** si la partida entra
en la cola (estado `queued`, con `queue_position`). El cliente se conecta igualmente a la señalización
y recibe `queue` con su posición; cuando se libera un hueco llega `session-state: starting` y el
worker se conecta. La cola es FIFO por plataforma y caduca a los 15 min (`CP_QUEUE_MAX_WAIT`).
Si ningún nodo sirve esa plataforma, la API responde **503** sin encolar.

## 2. Canal de datos `input` (binario, `ordered=false`, `maxRetransmits=0`)

Cada paquete es el **estado completo** de un mando, no un evento. Si se pierde uno, el siguiente
corrige el estado (sin botones pegados). Los clientes reenvían el estado cada 100 ms como keepalive.

### type = 1 · estado de mando (16 bytes, little endian)

| off | tipo | campo | rango |
|---|---|---|---|
| 0 | u8 | type | `1` |
| 1 | u8 | pad | 0..3 |
| 2 | u16 | buttons | bitmask (tabla abajo) |
| 4 | i16 | lx | -32768..32767 (negativo = izquierda) |
| 6 | i16 | ly | negativo = arriba |
| 8 | i16 | rx | |
| 10 | i16 | ry | |
| 12 | u8 | lt | 0..255 |
| 13 | u8 | rt | 0..255 |
| 14 | u16 | seq | contador con vuelta; el worker descarta paquetes con seq anterior |

### type = 2 · Guide/Home (4 bytes)
`[2, pad, pressed(0|1), 0]`

### type = 4 · ratón del jugador (6 bytes, solo con GunCon 2 o ratón USB)
`[4, botones, x lo, x hi, y lo, y hi]` · botones: bit 0 izquierdo, bit 1 derecho, bit 2 central · `x`, `y` de 0 a
65535 sobre la imagen del juego (sin las bandas negras). Estado completo, igual que los mandos. El worker lo
inyecta en el display virtual con XTest (`xinject.py`).

### Bits de `buttons` (orden W3C "standard gamepad")

| bit | botón | Xbox | PS2 | GameCube | Wii (Nunchuk) |
|---|---|---|---|---|---|
| 0 | A / sur | A | ✕ | A | A |
| 1 | B / este | B | ○ | X | — |
| 2 | X / oeste | X | □ | B | 1 |
| 3 | Y / norte | Y | △ | Y | 2 |
| 4 | LB | LB | L1 | — | C |
| 5 | RB | RB | R1 | Z | — |
| 6 | LT (digital) | LT | L2 | L | Z |
| 7 | RT (digital) | RT | R2 | R | B |
| 8 | Select | View | Select | — | − |
| 9 | Start | Menu | Start | Start | + |
| 10 | L3 | LS | L3 | — | — |
| 11 | R3 | RS | R3 | — | shake |
| 12-15 | D-pad ↑ ↓ ← → | | | | |

Si el cliente no tiene gatillo analógico (táctil, mando de la tele) basta con el bit 6/7: el worker lo
convierte en gatillo a fondo.

El worker expone cada mando como un **Xbox 360 virtual** (`045e:028e`) por uinput, y los perfiles de
PCSX2/Dolphin están mapeados sobre ese mando con SDL.

## 3. Canal de datos `control` (JSON, fiable y ordenado)

| `t` | Dirección | Efecto |
|---|---|---|
| `ping {ts}` → `pong {ts}` | cliente ↔ worker | RTT de aplicación |
| `bitrate {kbps}` | cliente → worker | cambia el bitrate del encoder en caliente (1000..MAX) |
| `keyframe` | cliente → worker | fuerza IDR |
| `savestate` / `loadstate` / `nextslot` / `screenshot` | cliente → worker | atajo del emulador (xdotool) |
| `quit` | cliente → worker | cierra el emulador limpiamente (vuelca memory cards) |
| `key {c, d}` | cliente → worker | tecla del jugador (`KeyboardEvent.code`, `d` 1 pulsada / 0 suelta) para teclado USB de PS2 o teclado de GameCube |
| `hello {encoder, bitrate}` | worker → cliente | al abrir el canal |
| `toast {text}` | worker → cliente | confirmación de acciones |
| `bye {reason}` | worker → cliente | `emulator-exit`, errores de stream |

## 3b. Canales `hid` y `hidfast`: Wiimote y Balance Board reales (solo en Wii)

El Wiimote del jugador, conectado a SU ordenador (Bluetooth o DolphinBar) y leído con WebHID, llega informe a
informe a Dolphin, que lo ve como un Wiimote real conectado a la consola. Ver `worker/session/cloudplay/hidbridge.py`
y `worker/session/hidshim/` (libhidapi propia de Dolphin).

| Mensaje | Dirección | Formato |
|---|---|---|
| vincular | cliente → worker | `[1, id, tipo]` · tipo 0 Wiimote, 1 Balance Board |
| desvincular | cliente → worker | `[2, id]` |
| informe | ambos | `[3, id, report_id, datos...]` (el informe HID tal cual) |
| estado | worker → cliente | `[4, id, 1/0]` · Dolphin lo ha cogido / soltado (para la animación) |

`hid` es fiable y ordenado (lecturas de memoria, acks, estado); `hidfast` no reintenta y lleva los informes
continuos `0x30`-`0x3F` (botones, IR, acelerómetro, extensión), donde el siguiente sustituye al anterior.

## 3c. Subida de micro y cámara

Si la sesión lleva `mic` o `camera` (o un accesorio que los usa), la offer del worker añade pistas `recvonly`:
audio Opus (PT 109) y vídeo VP8 (PT 97). El cliente les engancha `getUserMedia` (`sendonly`). El audio acaba en el
micro virtual de PulseAudio (`cloudplay_micsrc`, el micro por defecto de los emuladores) y el vídeo en
`/dev/video0` (v4l2loopback), que PCSX2 usa como EyeToy.

## 3d. Opciones de la partida (`POST /api/sessions`)

```json
{"game_id": "…", "options": {"wii_real": true, "mic": false, "camera": false, "accessories": ["gc_bongos"]}}
```
Accesorios válidos (máx. 4): `singstar`, `headset`, `eyetoy`, `buzz`, `guitar`, `drums`, `guncon2`, `usb_keyboard`,
`usb_mouse` (PS2) · `gc_bongos`, `gc_mic`, `gc_keyboard`, `gc_dancemat` (GameCube). Llegan al agente en el comando
`start` y a la sesión como `SESSION_OPTIONS`; `worker/session/accessories.py` configura PCSX2 y Dolphin.

### Bitrate adaptativo (en el cliente)

Cada 2 s con `getStats()` del `inbound-rtp` de vídeo:
- pérdida > 2 % → bitrate × 0,75
- pérdida < 0,5 % y se está usando > 60 % del objetivo → +500 kbps
- límites 2..20 Mbps; el usuario puede fijar una calidad manual desde el menú.

## 3e. LOCAL LAN MODE (red local entre consolas de la nube, solo PS2 y GameCube)

Mensajes por el canal `control`:

| Mensaje | Dirección | Cuerpo |
|---|---|---|
| `lan` | cliente → sesión | `{t:"lan", code:"K7Q2MX"}` entra en la sala (crea o se une) |
| `lan-leave` | cliente → sesión | sale de la sala (el cable queda "desenchufado") |
| `lan-status` | cliente → sesión | pide el estado (se manda al abrir el canal) |
| `lan` | sesión → cliente | `{t:"lan", state:"off"\|"waiting"\|"on"\|"unsupported", code, slot, members, error?, reconnecting?}` |

`state:"on"` = 2 o más consolas en la sala: el cliente enseña la animación **LOCAL LAN MODE ON**.

- **Código**: 6 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin O/0 ni I/1); se aceptan guiones (`K7Q-2MX`).
  La sala es `plataforma:código`, máx. 8 consolas, y se destruye con la última que sale.
- **Emulador ↔ sesión**: socket unix de flujo `/tmp/cloudplay-lan.sock`, cada trama Ethernet precedida de su
  longitud (2 bytes little endian; protocolo "tapserver" de Dolphin).
  - GameCube: Broadband Adapter en modo tapserver (`[Core] SerialPort1 = 11`, MAC `00:09:bf:xx:xx:xx` por sesión).
  - PS2: DEV9 en modo `PCAP Switched` sobre la libpcap de CloudPlay (`hidshim/lanpcap.c`); la MAC se reescribe por
    sesión en Ethernet y ARP.
- **DHCP**: lo contesta la sesión solo cuando la consola está en una sala: `10.77.0.(10+hueco)/24`, puerta de enlace y
  DNS `10.77.0.1` (no hay salida a Internet: es una LAN cerrada).
- **Sesión ↔ hub**: WebSocket `/ws/lan/{session_id}?token=<token de worker>`; binario = trama Ethernet (14..1518 bytes,
  máx. 3000/s por consola), texto = `{t:"join", code}` · `{t:"leave"}` → `{t:"lan", state, code, slot, members, error?}`.
  Switch con aprendizaje de MAC; entre réplicas de la API por Redis (`lanroom:*`, canal `lan:*`). 10 códigos malos
  por conexión y se corta.
- Wii no está: su red en Dolphin es emulada a nivel de sockets (sin Ethernet), así que no hay LAN que puentear.

## 4. Agente ↔ control plane (WebSocket `/ws/agent?token=<node_id>.<secret>`)

| Mensaje | Dirección | Cuerpo |
|---|---|---|
| `hello` | agente → | `{gpu, capacity, platforms[], inventory[{platform,path}], sessions[]}` |
| `heartbeat` | agente → | `{sessions[]}` cada 10 s |
| `session_state` | agente → | `{session_id, status: running\|ended\|failed, error}` |
| `start` | → agente | `{session_id, worker_token, signal_url, ice_servers, platform, rom_path, title, user_id}` |
| `stop` | → agente | `{session_id}` |

El `inventory` del `hello` da de alta automáticamente los juegos nuevos en el catálogo.
