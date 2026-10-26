"""Protocolo binario del canal de datos "input" (unordered, maxRetransmits=0).

Cada paquete es el ESTADO COMPLETO de un mando (no eventos), así que perder
paquetes no deja botones pegados: el siguiente arregla el estado. 16 bytes LE:

  off size campo
   0   u8   type     = 1 (estado de mando)
   1   u8   pad      índice de mando 0..3
   2   u16  buttons  bitmask (orden W3C standard gamepad, ver docs/PROTOCOL.md)
   4   i16  lx       -32768..32767  (negativo = izquierda)
   6   i16  ly       -32768..32767  (negativo = arriba)
   8   i16  rx
  10   i16  ry
  12   u8   lt       0..255
  13   u8   rt       0..255
  14   u16  seq      contador con vuelta; se descartan paquetes viejos

type=2 (4 bytes): botón Guide/Home -> [2, pad, pressed, 0]
type=4 (6 bytes): ratón del jugador (accesorios GunCon 2 / ratón USB) -> [4, botones, x u16, y u16]
                  x, y de 0 a 65535 sobre la imagen; estado completo, como los mandos
"""
import struct

PAD_STATE = struct.Struct("<BBHhhhhBBH")
assert PAD_STATE.size == 16
TYPE_PAD, TYPE_GUIDE, TYPE_MOUSE = 1, 2, 4


class InputDecoder:
    def __init__(self, max_pads: int):
        self.max_pads = max_pads
        self.last_seq: dict[int, int] = {}

    def decode(self, data: bytes):
        """Devuelve (pad, campos) o None si el paquete es inválido o viejo."""
        if len(data) == PAD_STATE.size and data[0] == TYPE_PAD:
            _, pad, buttons, lx, ly, rx, ry, lt, rt, seq = PAD_STATE.unpack(data)
            if pad >= self.max_pads:
                return None
            last = self.last_seq.get(pad)
            if last is not None and ((seq - last) & 0xFFFF) >= 0x8000:
                return None  # llegó tarde (canal unordered)
            self.last_seq[pad] = seq
            return pad, ("pad", buttons, lx, ly, rx, ry, lt, rt)
        if len(data) == 4 and data[0] == TYPE_GUIDE and data[1] < self.max_pads:
            return data[1], ("guide", bool(data[2]))
        if len(data) == 6 and data[0] == TYPE_MOUSE:
            return 0, ("mouse", data[1] & 7, data[2] | data[3] << 8, data[4] | data[5] << 8)
        return None

    def reset(self) -> None:
        self.last_seq.clear()
