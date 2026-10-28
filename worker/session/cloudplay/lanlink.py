"""Cable de red virtual de la consola: "LOCAL LAN MODE" con otras consolas de la nube que tengan el mismo código.

    emulador --(socket local, tramas Ethernet con 2 bytes de longitud)--> LanLink --(WebSocket)--> hub del orquestador

- Dolphin (GameCube, Broadband Adapter en modo "tapserver") se conecta tal cual a este socket.
- PCSX2 (PS2, adaptador de red DEV9 en modo PCAP) llega por la libpcap de CloudPlay (hidshim/lanpcap.c), que
  habla el mismo protocolo. Como PCSX2 deriva su MAC de la interfaz del contenedor (todas iguales), aquí se le da
  una MAC única por sesión (se reescribe en Ethernet y en ARP).
- DHCP: lo contesta este mismo módulo para SU consola (nada viaja por la red): la consola del hueco N de la sala
  recibe 10.77.0.(10+N)/24. Antes de unirse a una sala no hay DHCP: es como tener el cable desenchufado.
- Sin sala, las tramas no salen de aquí. Al salir de la sala se corta todo; la sala del hub se destruye sola.
"""
import asyncio
import hashlib
import json
import logging
import struct
from typing import Callable

log = logging.getLogger("cloudplay.lan")

SERVER_MAC = bytes.fromhex("02005e770001")
SERVER_IP = bytes([10, 77, 0, 1])
NETMASK = bytes([255, 255, 255, 0])
LEASE = 86400
MAX_FRAME = 1518


def ip_for(slot: int) -> bytes:
    return bytes([10, 77, 0, 10 + max(1, min(slot, 200))])


def session_mac(session_id: str, oui: bytes = b"\x02\xc9") -> bytes:
    """MAC estable y única por sesión (administrada localmente)"""
    h = hashlib.sha256(session_id.encode()).digest()
    return oui + h[: 6 - len(oui)]


def _csum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\0"
    s = sum(struct.unpack(f"!{len(data) // 2}H", data))
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    return ~s & 0xFFFF


def dhcp_reply(frame: bytes, slot: int) -> bytes | None:
    """Petición DHCP de la consola -> OFFER / ACK con su IP de la sala (None si no es DHCP)"""
    if len(frame) < 14 + 20 + 8 + 240 or frame[12:14] != b"\x08\x00":
        return None
    ihl = (frame[14] & 0x0F) * 4
    if frame[14 + 9] != 17:
        return None
    udp = 14 + ihl
    sport, dport = struct.unpack("!HH", frame[udp:udp + 4])
    if dport != 67:
        return None
    bootp = frame[udp + 8:]
    if len(bootp) < 240 or bootp[0] != 1 or bootp[236:240] != b"\x63\x82\x53\x63":
        return None
    msg_type, i = None, 240
    while i < len(bootp) and bootp[i] != 255:
        if bootp[i] == 0:
            i += 1
            continue
        if i + 1 >= len(bootp):
            break
        code, ln = bootp[i], bootp[i + 1]
        if code == 53 and ln >= 1:
            msg_type = bootp[i + 2]
        i += 2 + ln
    if msg_type not in (1, 3):  # DISCOVER, REQUEST
        return None
    xid, flags, chaddr = bootp[4:8], bootp[10:12], bootp[28:44]
    yiaddr = ip_for(slot)
    opts = bytes([53, 1, 2 if msg_type == 1 else 5]) + bytes([54, 4]) + SERVER_IP + bytes([51, 4]) + struct.pack("!I", LEASE)
    opts += bytes([1, 4]) + NETMASK + bytes([3, 4]) + SERVER_IP + bytes([6, 4]) + SERVER_IP + bytes([255])
    reply = bytes([2, 1, 6, 0]) + xid + b"\0\0" + flags + b"\0" * 4 + yiaddr + SERVER_IP + b"\0" * 4 + chaddr
    reply += b"\0" * 192 + b"\x63\x82\x53\x63" + opts
    reply += b"\0" * max(0, 300 - len(reply))
    udp_hdr = struct.pack("!HHHH", 67, 68, 8 + len(reply), 0)
    total = 20 + len(udp_hdr) + len(reply)
    ip_hdr = struct.pack("!BBHHHBBH4s4s", 0x45, 0, total, 0, 0, 64, 17, 0, SERVER_IP, b"\xff\xff\xff\xff")
    ip_hdr = ip_hdr[:10] + struct.pack("!H", _csum(ip_hdr)) + ip_hdr[12:]
    return b"\xff" * 6 + SERVER_MAC + b"\x08\x00" + ip_hdr + udp_hdr + reply


class MacRewriter:
    """La consola usa una MAC que se repite entre sesiones (PCSX2): fuera de aquí se ve con la única de la sesión"""

    def __init__(self, unique: bytes):
        self.unique = unique
        self.console: bytes | None = None

    def out(self, f: bytes) -> bytes:
        if self.console is None and not (f[6] & 1):
            self.console = f[6:12]
        if self.console is None or f[6:12] != self.console:
            return f
        b = bytearray(f)
        b[6:12] = self.unique
        if f[12:14] == b"\x08\x06" and len(f) >= 42 and f[22:28] == self.console:
            b[22:28] = self.unique  # ARP: dirección del que pregunta
        return bytes(b)

    def inn(self, f: bytes) -> bytes:
        if self.console is None:
            return f
        b = bytearray(f)
        if f[0:6] == self.unique:
            b[0:6] = self.console
        if f[12:14] == b"\x08\x06" and len(f) >= 42 and f[32:38] == self.unique:
            b[32:38] = self.console  # ARP: dirección por la que se pregunta
        return bytes(b)


class LanLink:
    def __init__(self, sock_path: str, hub_url: str, notify: Callable[[dict], None], rewrite_mac: bytes | None = None):
        self.sock_path, self.hub_url, self.notify = sock_path, hub_url, notify
        self.rewriter = MacRewriter(rewrite_mac) if rewrite_mac else None
        self.writer: asyncio.StreamWriter | None = None
        self.ws = None
        self.code: str | None = None
        self.slot = 0
        self.state = "off"
        self._ws_task: asyncio.Task | None = None
        self._server = None
        self.stats = {"out": 0, "in": 0, "dhcp": 0}

    # ------------------------------------------------------------ emulador
    async def start(self) -> None:
        try:
            import os
            os.unlink(self.sock_path)
        except OSError:
            pass
        self._server = await asyncio.start_unix_server(self._on_console, path=self.sock_path)

    async def _on_console(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        old, self.writer = self.writer, writer  # la última conexión manda (el emulador puede reconectar)
        if old is not None:
            old.close()
        log.info("la consola ha enchufado su cable de red")
        try:
            while True:
                hdr = await reader.readexactly(2)
                n = hdr[0] | hdr[1] << 8
                frame = await reader.readexactly(n)
                if 14 <= n <= MAX_FRAME:
                    await self._from_console(frame)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            if self.writer is writer:
                self.writer = None

    def _to_console(self, frame: bytes) -> None:
        w = self.writer
        if w is None or not (14 <= len(frame) <= MAX_FRAME):
            return
        if self.rewriter:
            frame = self.rewriter.inn(frame)
        w.write(struct.pack("<H", len(frame)) + frame)
        self.stats["in"] += 1

    async def _from_console(self, frame: bytes) -> None:
        if self.code is None:
            return  # sin sala: cable "desenchufado"
        reply = dhcp_reply(frame, self.slot) if self.slot else None
        if reply is not None:
            self.stats["dhcp"] += 1
            self._to_console(reply)
            return
        if self.rewriter:
            frame = self.rewriter.out(frame)
        ws = self.ws
        if ws is not None:
            try:
                await ws.send(frame)
                self.stats["out"] += 1
            except Exception:  # noqa: BLE001 - se reconecta solo
                pass

    # ----------------------------------------------------------------- hub
    def join(self, code: str) -> None:
        self.code = code
        if self._ws_task is None or self._ws_task.done():
            self._ws_task = asyncio.create_task(self._hub())
        elif self.ws is not None:
            asyncio.create_task(self._send({"t": "join", "code": code}))

    def leave(self) -> None:
        self.code, self.slot = None, 0
        if self._ws_task:
            self._ws_task.cancel()
            self._ws_task = None
        self._set_state({"t": "lan", "state": "off"})

    async def _send(self, msg: dict) -> None:
        try:
            await self.ws.send(json.dumps(msg))
        except Exception:  # noqa: BLE001
            pass

    def _set_state(self, msg: dict) -> None:
        self.state = msg.get("state", "off")
        if self.state == "off":
            self.slot = 0
        else:
            self.slot = int(msg.get("slot") or 0)
        self.notify(msg)

    async def _hub(self) -> None:
        import websockets

        delay = 1.0
        while self.code is not None:
            try:
                async with websockets.connect(self.hub_url, ping_interval=20, max_size=2**16) as ws:
                    self.ws = ws
                    delay = 1.0
                    await self._send({"t": "join", "code": self.code})
                    async for m in ws:
                        if isinstance(m, bytes):
                            self._to_console(m)
                            continue
                        try:
                            msg = json.loads(m)
                        except ValueError:
                            continue
                        if msg.get("t") == "lan":
                            self._set_state(msg)
                            if msg.get("state") == "off" and msg.get("error"):
                                self.code = None  # código malo o sala llena: no se insiste
                                return
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - red caída: se reintenta
                log.warning("hub LAN: %s", e)
            finally:
                self.ws = None
            if self.code is not None:
                self._set_state({"t": "lan", "state": "waiting", "code": self.code, "members": 0, "reconnecting": True})
                await asyncio.sleep(delay)
                delay = min(delay * 2, 15)

    async def close(self) -> None:
        self.leave()
        if self._server is not None:
            self._server.close()
