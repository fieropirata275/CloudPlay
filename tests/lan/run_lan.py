"""LOCAL LAN MODE de extremo a extremo (sin emuladores): API real (devserver) + hub LAN + dos lanlink.py de dos
sesiones de PS2, cada una con una "consola" que habla el protocolo del cable (el mismo que Dolphin y la libpcap
de CloudPlay; los dos emuladores ya se han probado conectándose a él). Las dos consolas tienen la MISMA MAC, como
dos PCSX2 de verdad: el puente tiene que darles una única a cada una.

    python3 tests/lan/run_lan.py     -> LAN_E2E_OK
"""
import asyncio
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path.insert(0, os.path.join(ROOT, "worker", "session"))
from cloudplay.lanlink import LanLink, session_mac  # noqa: E402

import websockets  # noqa: E402

PORT = 8079
B = f"http://localhost:{PORT}"
PS2_MAC = bytes.fromhex("00041f820000")  # la que pone PCSX2 a todas (MAC de lo = 0)


def api(method, path, body=None, tok=None):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **({"authorization": "Bearer " + tok} if tok else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or "null")


def dhcp_discover(mac: bytes) -> bytes:
    bootp = bytes([1, 1, 6, 0]) + b"\x12\x34\x56\x78" + b"\0" * 4 + b"\0" * 16 + mac + b"\0" * 10 + b"\0" * 192
    bootp += b"\x63\x82\x53\x63" + bytes([53, 1, 1, 255]) + b"\0" * 20
    udp = struct.pack("!HHHH", 68, 67, 8 + len(bootp), 0) + bootp
    ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(udp), 0, 0, 64, 17, 0, b"\0" * 4, b"\xff" * 4)
    return b"\xff" * 6 + mac + b"\x08\x00" + ip + udp


def arp(op, smac, sip, tmac, tip, dst):
    return dst + smac + b"\x08\x06" + struct.pack("!HHBBH", 1, 0x0800, 6, 4, op) + smac + sip + tmac + tip + bytes(18)


def udp_frame(dst_mac, src_mac, src_ip, dst_ip, payload):
    udp = struct.pack("!HHHH", 5000, 5000, 8 + len(payload), 0) + payload
    ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(udp), 0, 0, 64, 17, 0, src_ip, dst_ip)
    return dst_mac + src_mac + b"\x08\x00" + ip + udp


class Console:
    """Una consola enchufada al cable de su sesión"""

    def __init__(self, path):
        self.s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.s.connect(path)
        self.s.settimeout(0.2)
        self.buf = b""

    def send(self, f):
        self.s.sendall(struct.pack("<H", len(f)) + f)

    def frames(self, wait=1.5):
        out, end = [], time.time() + wait
        while time.time() < end:
            try:
                d = self.s.recv(65536)
                if not d:
                    break
                self.buf += d
            except socket.timeout:
                pass
            while len(self.buf) >= 2 and len(self.buf) >= 2 + (self.buf[0] | self.buf[1] << 8):
                n = self.buf[0] | self.buf[1] << 8
                out.append(self.buf[2:2 + n])
                self.buf = self.buf[2 + n:]
        return out


async def main():
    env = dict(os.environ, CP_STUN_URLS="", CP_TURN_URLS="")
    db = os.path.join(ROOT, "control-plane", "dev.db")
    if os.path.exists(db):
        os.remove(db)
    srv = subprocess.Popen([sys.executable, "devserver.py", str(PORT)], cwd=os.path.join(ROOT, "control-plane"), env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = False
    try:
        for _ in range(60):
            try:
                api("GET", "/api/health")
                break
            except OSError:
                time.sleep(0.3)
        tok = api("POST", "/api/auth/login", {"email": "admin@local", "password": "devpassword"})["access_token"]
        node = api("POST", "/api/admin/nodes", {"name": "lan", "capacity": 4}, tok)["token"]
        agent = await websockets.connect(f"ws://localhost:{PORT}/ws/agent?token={node}")
        await agent.send(json.dumps({"type": "hello", "gpu": "cpu", "capacity": 4, "platforms": ["ps2"], "inventory": [], "sessions": []}))
        await asyncio.sleep(0.5)
        ps2 = next(g for g in api("GET", "/api/games", tok=tok) if g["platform"] == "ps2")
        starts = []
        for _ in range(3):
            api("POST", "/api/sessions", {"game_id": ps2["id"]}, tok)
            while True:
                m = json.loads(await agent.recv())
                if m.get("type") == "start":
                    starts.append(m)
                    break
        tmp = tempfile.mkdtemp()
        states = {0: [], 1: [], 2: []}
        links, consoles = [], []
        for i, st in enumerate(starts):
            hub = st["signal_url"].replace("/ws/signal/", "/ws/lan/") + "?token=" + st["worker_token"]
            link = LanLink(os.path.join(tmp, f"lan{i}.sock"), hub, states[i].append, rewrite_mac=session_mac(st["session_id"]))
            await link.start()
            links.append(link)
        loop = asyncio.get_running_loop()
        for i in range(3):
            consoles.append(await loop.run_in_executor(None, Console, os.path.join(tmp, f"lan{i}.sock")))
        await asyncio.sleep(0.2)

        # Sin sala: el cable está "desenchufado" (ni DHCP)
        consoles[0].send(dhcp_discover(PS2_MAC))
        assert await loop.run_in_executor(None, consoles[0].frames, 0.6) == [], "sin sala no debería haber DHCP"

        links[0].join("K7Q2MX")
        links[1].join("k7q-2mx")
        links[2].join("ABCDEF")  # otra sala
        await asyncio.sleep(1.5)
        print("estados:", [s[-1].get("state") if s else None for s in states.values()], "· huecos:", [l.slot for l in links])
        assert states[0][-1]["state"] == "on" and states[1][-1]["state"] == "on" and states[2][-1]["state"] == "waiting"

        a, b, c = consoles
        a.send(dhcp_discover(PS2_MAC))
        b.send(dhcp_discover(PS2_MAC))
        fa = await loop.run_in_executor(None, a.frames, 0.8)
        fb = await loop.run_in_executor(None, b.frames, 0.3)
        ip_a = fa[0][14 + 20 + 8 + 16:14 + 20 + 8 + 20]
        ip_b = fb[0][14 + 20 + 8 + 16:14 + 20 + 8 + 20]
        print("DHCP:", socket.inet_ntoa(ip_a), socket.inet_ntoa(ip_b))
        assert {ip_a, ip_b} == {bytes([10, 77, 0, 11]), bytes([10, 77, 0, 12])}

        # ARP: A pregunta por B (broadcast). B lo ve con la MAC única de A, no con la de PCSX2
        a.send(arp(1, PS2_MAC, ip_a, b"\0" * 6, ip_b, b"\xff" * 6))
        got = [f for f in await loop.run_in_executor(None, b.frames, 1.0) if f[12:14] == b"\x08\x06"]
        assert got, "B no recibió el ARP"
        mac_a_seen = got[0][6:12]
        assert mac_a_seen == session_mac(starts[0]["session_id"]) and got[0][22:28] == mac_a_seen
        # B contesta a esa MAC; a A le llega con SU MAC de consola como destino
        b.send(arp(2, PS2_MAC, ip_b, mac_a_seen, ip_a, mac_a_seen))
        rep = [f for f in await loop.run_in_executor(None, a.frames, 1.0) if f[12:14] == b"\x08\x06"]
        assert rep and rep[0][0:6] == PS2_MAC and rep[0][32:38] == PS2_MAC, "la respuesta ARP no volvió a la MAC de la consola"
        mac_b_seen = rep[0][6:12]
        assert mac_b_seen == session_mac(starts[1]["session_id"]) != mac_a_seen
        # UDP: anuncio de partida por broadcast y respuesta unicast
        a.send(udp_frame(b"\xff" * 6, PS2_MAC, ip_a, b"\xff" * 4, b"PARTIDA LAN: GT4"))
        assert any(b"PARTIDA LAN: GT4" in f for f in await loop.run_in_executor(None, b.frames, 1.0))
        b.send(udp_frame(mac_a_seen, PS2_MAC, ip_b, ip_a, b"me uno"))
        assert any(b"me uno" in f and f[0:6] == PS2_MAC for f in await loop.run_in_executor(None, a.frames, 1.0))
        # La otra sala no ha visto nada
        assert await loop.run_in_executor(None, c.frames, 0.5) == []
        print("ARP, broadcast y unicast entre las dos consolas: ok · MACs:", mac_a_seen.hex(":"), mac_b_seen.hex(":"))

        # B sale: A vuelve a "esperando"; sin sala, el cable de B vuelve a estar desenchufado
        links[1].leave()
        await asyncio.sleep(1.0)
        assert states[0][-1]["state"] == "waiting" and states[0][-1]["members"] == 1
        b.send(udp_frame(b"\xff" * 6, PS2_MAC, ip_b, b"\xff" * 4, b"sigo aqui?"))
        assert not any(b"sigo aqui?" in f for f in await loop.run_in_executor(None, a.frames, 0.8))
        print("salida de la sala: ok")
        for link in links:
            await link.close()
        await agent.close()
        ok = True
    finally:
        srv.terminate()
        srv.wait(timeout=10)
    print("LAN_E2E_OK" if ok else "LAN_E2E_FAIL")


asyncio.run(main())
