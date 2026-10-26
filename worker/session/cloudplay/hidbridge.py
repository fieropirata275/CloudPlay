"""Puente HID: el Wiimote / Balance Board REAL del jugador, conectado a su ordenador, aparece en Dolphin como
si estuviera enchufado a la consola de la nube.

    navegador / app de escritorio  <-- canales WebRTC "hid" y "hidfast" -->  HidBridge  <-- socket -->  Dolphin
                                                                                          (hidshim/libhidapi)

Cada dispositivo vinculado es un socket SOCK_SEQPACKET en HID_DIR (wiimote-N.sock / board-N.sock): un mensaje
es un informe HID con su ID delante, igual que en hidapi. Dolphin los encuentra al escanear (continuamente)
y los conecta a su ranura.

Mensajes binarios por los canales (docs/PROTOCOL.md):
  cliente -> nube   0x01 link [id, tipo(0 Wiimote, 1 Balance Board)] · 0x02 unlink [id] · 0x03 informe [id, ...]
  nube -> cliente   0x03 informe de salida [id, ...] · 0x04 estado [id, 1 = la consola lo ha abierto / 0 = soltado]
Los informes de entrada 0x30-0x3F (botones, acelerómetro, IR, extensión) van por "hidfast" (sin orden ni
reintentos: el siguiente sustituye al anterior); el resto (lecturas de memoria, acks, estado) por "hid" (fiable).
"""
import logging
import os
import socket
import threading
from typing import Callable

log = logging.getLogger("cloudplay.hid")

LINK, UNLINK, REPORT, STATE = 0x01, 0x02, 0x03, 0x04
KINDS = {0: "wiimote", 1: "board"}
MAX_DEVICES = 8


class _Device:
    def __init__(self, dev_id: int, kind: str, path: str):
        self.id, self.kind, self.path = dev_id, kind, path
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        self.server.bind(path)
        os.chmod(path, 0o666)
        self.server.listen(4)
        self.conns: list[socket.socket] = []
        self.lock = threading.Lock()
        self.closed = False


class HidBridge:
    def __init__(self, hid_dir: str, send: Callable[[bytes], None]):
        """send(msg): manda un mensaje binario al cliente (por el canal fiable "hid")"""
        self.dir = hid_dir
        self.send = send
        self.devices: dict[int, _Device] = {}
        self.lock = threading.Lock()
        os.makedirs(hid_dir, exist_ok=True)
        for f in os.listdir(hid_dir):  # restos de una sesión anterior
            if f.endswith(".sock"):
                try:
                    os.unlink(os.path.join(hid_dir, f))
                except OSError:
                    pass

    # ------------------------------------------------------------ del cliente
    def on_message(self, data: bytes) -> None:
        if len(data) < 2:
            return
        t, dev_id = data[0], data[1]
        if t == REPORT:
            self._to_console(dev_id, data[2:])
        elif t == LINK and len(data) >= 3:
            self.link(dev_id, KINDS.get(data[2], "wiimote"))
        elif t == UNLINK:
            self.unlink(dev_id)

    def link(self, dev_id: int, kind: str) -> None:
        if dev_id >= MAX_DEVICES:
            return
        with self.lock:
            old = self.devices.get(dev_id)
            if old is not None and old.kind == kind and not old.closed:
                return
        self.unlink(dev_id)
        # El número del nombre ordena el escaneo de Dolphin: el primero que vincula el jugador va a la ranura 1
        path = os.path.join(self.dir, f"{kind}-{dev_id + 1}.sock")
        try:
            dev = _Device(dev_id, kind, path)
        except OSError as e:
            log.warning("no se pudo crear %s: %s", path, e)
            return
        with self.lock:
            self.devices[dev_id] = dev
        threading.Thread(target=self._accept, args=(dev,), daemon=True, name=f"hid-{kind}-{dev_id}").start()
        log.info("%s %d vinculado", kind, dev_id)

    def unlink(self, dev_id: int) -> None:
        with self.lock:
            dev = self.devices.pop(dev_id, None)
        if dev is None:
            return
        dev.closed = True
        try:
            os.unlink(dev.path)
        except OSError:
            pass
        try:
            dev.server.close()
        except OSError:
            pass
        with dev.lock:
            conns, dev.conns = dev.conns, []
        for c in conns:  # Dolphin lee -1 y da el Wiimote por desconectado
            try:
                c.shutdown(socket.SHUT_RDWR)
                c.close()
            except OSError:
                pass
        log.info("%s %d desvinculado", dev.kind, dev_id)

    def unlink_all(self) -> None:
        for dev_id in list(self.devices):
            self.unlink(dev_id)

    def _to_console(self, dev_id: int, report: bytes) -> None:
        dev = self.devices.get(dev_id)
        if dev is None or not report:
            return
        with dev.lock:
            conns = list(dev.conns)
        for c in conns:
            try:
                c.send(report)
            except OSError:
                pass

    # ----------------------------------------------------------- de Dolphin
    def _accept(self, dev: _Device) -> None:
        while not dev.closed:
            try:
                c, _ = dev.server.accept()
            except OSError:
                return
            with dev.lock:
                dev.conns.append(c)
            threading.Thread(target=self._pump, args=(dev, c), daemon=True).start()

    def _pump(self, dev: _Device, c: socket.socket) -> None:
        opened = False
        try:
            while True:
                rpt = c.recv(64)
                if not rpt:
                    break
                # Dolphin abre una vez para comprobar el dispositivo (manda un informe con el prefijo 0xA2) y
                # luego de verdad: el estado "conectado" se avisa con el primer informe normal.
                if rpt[0] == 0xA2:
                    continue
                if not opened:
                    opened = True
                    self.send(bytes([STATE, dev.id, 1]))
                self.send(bytes([REPORT, dev.id]) + rpt)
        except OSError:
            pass
        finally:
            with dev.lock:
                if c in dev.conns:
                    dev.conns.remove(c)
            try:
                c.close()
            except OSError:
                pass
            if opened:
                self.send(bytes([STATE, dev.id, 0]))
