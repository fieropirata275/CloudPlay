"""Wiimote / Balance Board simulado: responde al protocolo HID del Wiimote lo suficiente para que Dolphin lo
detecte, lo conecte y le pida datos. Lo usan las pruebas del puente HID (sin hardware).

Informes (el primer byte es el ID): 0x15 estado -> 0x20 · 0x16 escribir memoria -> 0x22 ack · 0x17 leer memoria
-> 0x21 (de 16 en 16) · 0x12 modo de datos -> informes 0x3x periódicos.
"""
import struct

MODE_LEN = {0x30: 2, 0x31: 5, 0x32: 10, 0x33: 17, 0x34: 21, 0x35: 21, 0x36: 21, 0x37: 21, 0x3D: 21, 0x3E: 21, 0x3F: 21}


class FakeWiimote:
    def __init__(self, board: bool = False):
        self.board = board
        self.mode = 0x30
        self.buttons = 0
        self.log: list[int] = []  # IDs de los informes recibidos

    def _ext_id(self) -> bytes:
        # 0xa400fa..ff: identificador de la extensión. Balance Board = ..0402
        return bytes([0x00, 0x00, 0xA4, 0x20, 0x04, 0x02]) if self.board else bytes(6)

    def handle(self, rpt: bytes) -> list[bytes]:
        """Informe de salida (de la consola) -> informes de entrada de respuesta"""
        if not rpt:
            return []
        rid = rpt[0]
        self.log.append(rid)
        btn = struct.pack(">H", self.buttons)
        if rid == 0x15:  # estado
            flags = 0x02 if self.board else 0x00  # bit 1: extensión conectada
            return [bytes([0x20]) + btn + bytes([flags, 0, 0, 0xC8])]
        if rid == 0x16:  # escribir memoria / registros
            return [bytes([0x22]) + btn + bytes([0x16, 0x00])]
        if rid == 0x17:  # leer memoria / registros
            space, addr, size = rpt[1], int.from_bytes(rpt[2:5], "big"), int.from_bytes(rpt[5:7], "big")
            out = []
            off = 0
            while off < size:
                n = min(16, size - off)
                a = addr + off
                data = bytearray(16)
                err = 0
                if space & 0x04 and (a >> 16) == 0xA4:
                    if not self.board:
                        err = 7  # sin extensión
                    else:
                        for i in range(n):
                            r = (a + i) & 0xFF
                            if 0xFA <= r <= 0xFF:
                                data[i] = self._ext_id()[r - 0xFA]
                out.append(bytes([0x21]) + btn + bytes([((n - 1) << 4) | err]) + struct.pack(">H", a & 0xFFFF) + bytes(data))
                if err:
                    break
                off += n
            return out
        if rid == 0x12:  # modo de datos
            self.mode = rpt[2] if len(rpt) > 2 else 0x30
            return [bytes([0x22]) + btn + bytes([0x12, 0x00])] if rpt[1] & 0x02 else []
        if rid in (0x11, 0x13, 0x14, 0x18, 0x19, 0x1A) and len(rpt) > 1 and rpt[1] & 0x02:
            return [bytes([0x22]) + btn + bytes([rid, 0x00])]
        return []

    def periodic(self) -> bytes:
        n = MODE_LEN.get(self.mode, 2)
        payload = struct.pack(">H", self.buttons) + bytes(n - 2)
        return bytes([self.mode]) + payload
