# Mandos y accesorios

La consola está en la nube, pero se juega como si estuviera en tu ordenador: lo que conectas a tu PC (mandos
originales, Wiimote, Balance Board, micro, cámara, teclado, ratón) le llega a la consola como si estuviera
enchufado a ella.

Dónde funciona cada cosa:

| | Navegador (Chrome / Edge de escritorio) | App de escritorio | Móvil y Android TV | Teles (Tizen / webOS) |
|---|---|---|---|---|
| Mandos USB / Bluetooth, mandos originales con adaptador | Sí | Sí | Sí | Sí |
| Wiimote y Balance Board reales | Sí (lo autorizas una vez) | Sí (sin preguntar) | No (Wiimote emulado con el mando) | No |
| Micro y cámara | Sí (permiso del navegador) | Sí (sin preguntar) | — | — |
| Teclado y ratón como accesorio | Sí | Sí | — | — |

## Mandos originales de PS2 y GameCube

Conéctalos con su adaptador USB (Mayflash, Super Dual Box, adaptadores genéricos de PS2…). CloudPlay reconoce
unos 860 mandos y adaptadores por su USB (base de [SDL_GameControllerDB](https://github.com/mdqinc/SDL_GameControllerDB))
y coloca los botones solo. En **Mandos** (biblioteca) ves cada botón, stick y gatillo iluminarse al pulsarlo.

Si alguno no cuadra, **Configurar** → eliges qué mando es (PS2, GameCube u otro) → pulsas cada botón cuando te lo
pide, con su nombre de verdad (✕ ◯ □ △, A B X Y Z…). Se guarda en ese dispositivo para ese modelo de mando. También
está en el menú de la partida (**Configurar mando**) y en la app de Android.

Los receptores **Buzz!** de verdad (USB) se reparten solos como 4 jugadores.

## Wiimote y Balance Board

Dolphin no emula la Balance Board, y el Wiimote real es mucho más fiel que uno emulado (puntero IR, altavoz,
vibración, MotionPlus, Nunchuk, Classic, guitarras de extensión…). Por eso CloudPlay manda **tu** Wiimote a la
consola de la nube, informe a informe.

1. Conéctalo a tu ordenador:
   - **DolphinBar de Mayflash** en modo 4 (lo más cómodo; además es la barra de sensores), o
   - **Bluetooth del ordenador**: Windows → *Configuración → Bluetooth y dispositivos → Agregar dispositivo →
     Bluetooth*; pulsa **SYNC** (bajo la tapa de las pilas; en la Balance Board, en el hueco de las pilas) y elige
     *Nintendo RVL-CNT-01* / *RVL-WBC-01*. Si pide PIN, déjalo vacío.
2. En **Mandos → Añadir Wiimote o Balance Board** (en la app de escritorio no hace falta: los coge solos).
3. Juega a un juego de Wii: el Wiimote entra en la ranura 1 y su LED se enciende; los demás jugadores pueden
   vincular el suyo a mitad de partida (ranuras 2-4), igual que la Balance Board.

Para el puntero hace falta una barra de sensores delante de la pantalla (la de tu Wii con adaptador USB, una
inalámbrica de pilas o la DolphinBar).

Sin Wiimote real, la Wii se juega con cualquier mando (Wiimote + Nunchuk emulados).

## Accesorios

Al lanzar un juego que los usa (SingStar, Buzz!, Guitar Hero, Donkey Konga, Mario Party 6/7…) CloudPlay te propone
sus accesorios; también puedes cambiarlos en **Menú → Accesorios** (reinicia la partida: guarda antes).

| Consola | Accesorio | Con qué lo haces desde tu ordenador |
|---|---|---|
| PS2 | Micros de SingStar, auriculares USB | Tu micro |
| PS2 | EyeToy | Tu cámara (los nodos necesitan `v4l2loopback`, el instalador lo pone) |
| PS2 | Pulsadores Buzz! | Tus Buzz! USB o hasta 4 mandos (rojo = ✕/A) |
| PS2 | Guitarra de Guitar Hero | Tu guitarra USB o un mando (verde R2, rojo ◯, amarillo △, azul ✕, naranja □) |
| PS2 | Batería USB | Tu batería USB o un mando (verde A, rojo B, azul X, amarillo Y, bombo LB) |
| PS2 | GunCon 2 | Tu ratón: apuntas sobre la imagen y disparas con clic |
| PS2 | Teclado y ratón USB | Los tuyos |
| GameCube | Bongos de DK | Tus bongos con adaptador o un mando |
| GameCube | Micrófono | Tu micro (Mario Party 6 y 7) |
| GameCube | Alfombra de baile | Tu alfombra USB o un mando |
| GameCube | Teclado (Phantasy Star Online) | Tu teclado |

En partida, **Menú → Silenciar el micro** lo corta sin salir.

## Límites conocidos

- **Wii Speak** y el **teclado USB de Wii**: el Dolphin de los nodos (2503) no los emula en Linux.
- Botones sensibles a la presión del DualShock 2: casi ningún adaptador los manda; llegan como normales.
- Accesorios de Wii por USB (Rock Band de Wii, Skylanders, etc.): necesitarían el USB del ordenador del jugador
  dentro de la consola, todavía no.
- Wiimote real en Android y en las teles: sus navegadores no tienen WebHID.
- La app de escritorio de macOS no está firmada: la primera vez, clic derecho → Abrir.
