"""Test de extremo a extremo del control plane con SQLite + fakeredis.

  pip install -r requirements.txt aiosqlite fakeredis pytest httpx
  pytest -q
"""
import os
import time

os.environ["CP_DATABASE_URL"] = "sqlite+aiosqlite:///./test.db"
os.environ["CP_ADMIN_EMAIL"] = "admin@test.local"
os.environ["CP_ADMIN_PASSWORD"] = "supersecret"
os.environ["CP_PUBLIC_URL"] = "http://testserver"

import fakeredis  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

if os.path.exists("test.db"):
    os.remove("test.db")

from app import bus  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    bus.set_client(fakeredis.FakeAsyncRedis(decode_responses=True))
    with TestClient(app) as c:
        yield c


def recv_until(ws, kind, limit=10):
    for _ in range(limit):
        m = ws.receive_json()
        if m.get("type") == kind:
            return m
    raise AssertionError(f"no llegó {kind}")


def test_full_flow(client):
    tok = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "supersecret"}).json()[
        "access_token"
    ]
    H = {"Authorization": f"Bearer {tok}"}

    node = client.post("/api/admin/nodes", json={"name": "gpu-01", "capacity": 1}, headers=H).json()
    assert "." in node["token"]

    # Sin nodos online no se puede jugar
    with client.websocket_connect(f"/ws/agent?token={node['token']}") as agent:
        agent.send_json(
            {
                "type": "hello",
                "gpu": "nvidia",
                "capacity": 1,
                "platforms": ["ps2", "gc"],
                "inventory": [
                    {"platform": "ps2", "path": "ps2/Shadow of the Colossus (USA).iso"},
                    {"platform": "gc", "path": "gc/Wind_Waker [EU].rvz"},
                    {"platform": "xbox", "path": "nope.iso"},
                ],
                "sessions": [],
            }
        )
        time.sleep(0.3)
        games = client.get("/api/games", headers=H).json()
        titles = sorted(g["title"] for g in games)
        assert titles == ["Shadow of the Colossus", "Wind Waker"], titles
        ps2 = next(g for g in games if g["platform"] == "ps2")

        s = client.post("/api/sessions", json={"game_id": ps2["id"]}, headers=H)
        assert s.status_code == 201, s.text
        sess = s.json()
        assert sess["status"] == "starting" and sess["ice_servers"]

        start = recv_until(agent, "start")
        assert start["rom_path"].startswith("ps2/") and start["session_id"] == sess["id"]

        # Capacidad del nodo = 1 -> la segunda sesión va a la COLA (el admin tiene cupo de 4)
        q = client.post("/api/sessions", json={"game_id": ps2["id"]}, headers=H)
        assert q.status_code == 202, q.text
        queued = q.json()
        assert queued["status"] == "queued" and queued["queue_position"] == 1
        gc = next(g for g in games if g["platform"] == "gc")

        agent.send_json({"type": "session_state", "session_id": sess["id"], "status": "running"})
        time.sleep(0.2)
        assert client.get(f"/api/sessions/{sess['id']}", headers=H).json()["status"] == "running"

        # Señalización: token incorrecto rechazado
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/signal/{sess['id']}?role=worker&token=bad") as w:
                w.receive_json()

        sid = sess["id"]
        with client.websocket_connect(f"/ws/signal/{sid}?role=worker&token={start['worker_token']}") as worker:
            with client.websocket_connect(f"/ws/signal/{sid}?role=client&token={tok}") as cl:
                assert recv_until(cl, "peer-joined")["role"] == "worker"
                assert recv_until(worker, "peer-joined")["role"] == "client"
                worker.send_json({"type": "offer", "sdp": "v=0..."})
                offer = recv_until(cl, "offer")
                assert offer["sdp"] == "v=0..." and offer["from"] == "worker"
                cl.send_json({"type": "answer", "sdp": "v=0 answer"})
                assert recv_until(worker, "answer")["sdp"] == "v=0 answer"
                cl.send_json({"type": "hack", "x": 1})  # tipo no permitido: se ignora
                cl.send_json({"type": "ice", "candidate": "candidate:1 1 udp 1 1.2.3.4 5 typ host", "sdpMLineIndex": 0})
                assert recv_until(worker, "ice")["sdpMLineIndex"] == 0
            assert recv_until(worker, "peer-left")["role"] == "client"

        # Terminar
        assert client.delete(f"/api/sessions/{sid}", headers=H).json()["status"] == "ending"
        assert recv_until(agent, "stop")["session_id"] == sid
        agent.send_json({"type": "session_state", "session_id": sid, "status": "ended"})
        time.sleep(0.2)
        assert client.get(f"/api/sessions/{sid}", headers=H).json()["status"] == "ended"

        # Queda hueco -> el dispatcher saca de la cola la sesión en espera y la manda al nodo
        start2 = recv_until(agent, "start", limit=20)
        assert start2["session_id"] == queued["id"] and start2["worker_token"]
        assert client.get(f"/api/sessions/{queued['id']}", headers=H).json()["status"] == "starting"
        agent.send_json({"type": "session_state", "session_id": queued["id"], "status": "running"})
        time.sleep(0.2)

        # Panel admin: métricas, listado enriquecido y cierre forzado
        st = client.get("/api/admin/stats", headers=H).json()
        assert st["placed"] == 1 and st["queued"] == 0 and st["nodes_online"] == 1
        rows = client.get("/api/admin/sessions", headers=H).json()
        assert rows[0]["user"] == "admin@test.local" and rows[0]["node"] == "gpu-01"
        assert client.delete(f"/api/admin/sessions/{queued['id']}", headers=H).json()["status"] == "ending"
        assert recv_until(agent, "stop")["session_id"] == queued["id"]

        # Favoritos y recientes
        assert client.put(f"/api/favorites/{ps2['id']}", headers=H).json()["favorite"] is True
        g2 = {g["id"]: g for g in client.get("/api/games", headers=H).json()}
        assert g2[ps2["id"]]["favorite"] and g2[ps2["id"]]["play_count"] >= 1 and g2[ps2["id"]]["last_played"]
        assert not g2[gc["id"]]["favorite"] and g2[gc["id"]]["play_count"] == 0
        client.delete(f"/api/favorites/{ps2['id']}", headers=H)
        assert not client.get("/api/games", headers=H).json()[0]["favorite"]


def test_device_flow(client):
    tok = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "supersecret"}).json()[
        "access_token"
    ]
    # Plataforma que ningún nodo sirve -> 503 inmediato (no se encola para siempre)
    H = {"Authorization": f"Bearer {tok}"}
    wii = client.post("/api/admin/games", json={"title": "X", "platform": "wii", "rom_path": "wii/x.wbfs"}, headers=H).json()
    r = client.post("/api/sessions", json={"game_id": wii["id"]}, headers=H)
    assert r.status_code == 503, r.text
    d = client.post("/api/auth/device/start").json()
    assert len(d["user_code"]) == 9
    assert client.post("/api/auth/device/poll", json={"device_code": d["device_code"]}).json()["status"] == "pending"
    r = client.post(
        "/api/auth/device/approve",
        json={"user_code": d["user_code"].replace("-", "").lower()},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 200, r.text
    p = client.post("/api/auth/device/poll", json={"device_code": d["device_code"]}).json()
    assert p["status"] == "approved" and p["access_token"]
    # un solo uso
    assert client.post("/api/auth/device/poll", json={"device_code": d["device_code"]}).status_code == 410


def test_turn_credentials():
    import base64
    import hashlib
    import hmac

    from app.config import settings
    from app.security import ice_servers

    turn = ice_servers("user-x")[1]
    exp = hmac.new(settings.turn_secret.encode(), turn["username"].encode(), hashlib.sha1).digest()
    assert base64.b64decode(turn["credential"]) == exp
    assert int(turn["username"].split(":")[0]) > time.time()


def test_leads(client):
    ok = client.post("/api/leads", json={"name": "Laura", "email": "laura@cliente.es", "company": "Bar Retro", "players": "10-50"})
    assert ok.status_code == 201, ok.text
    assert client.post("/api/leads", json={"name": "Bot", "email": "x@y.zz", "website": "spam"}).status_code == 201  # honeypot
    assert client.post("/api/leads", json={"name": "Mal", "email": "no-es-email"}).status_code == 422
    for _ in range(4):
        client.post("/api/leads", json={"name": "Otra", "email": "o@cliente.es"})
    assert client.post("/api/leads", json={"name": "Otra", "email": "o@cliente.es"}).status_code == 429
    tok = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "supersecret"}).json()["access_token"]
    rows = client.get("/api/admin/leads", headers={"Authorization": f"Bearer {tok}"}).json()
    assert rows[-1]["email"] == "laura@cliente.es" and rows[-1]["company"] == "Bar Retro"
    assert not any(r["name"] == "Bot" for r in rows)
    assert client.get("/api/admin/leads").status_code == 401


def _admin(client):
    tok = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "supersecret"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def test_ready(client):
    assert client.get("/api/ready").json() == {"ok": True}


def test_enroll_and_drain(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "join_token", "j" * 32)
    bad = client.post("/api/nodes/enroll", json={"join_token": "x" * 32, "name": "auto-01"})
    assert bad.status_code == 401
    r = client.post("/api/nodes/enroll", json={"join_token": "j" * 32, "name": "auto-01", "capacity": 3, "platforms": ["ps2"]})
    assert r.status_code == 201 and r.json()["token"].startswith(r.json()["id"] + ".")
    # reinstalar la misma máquina: mismo nodo, token nuevo
    r2 = client.post("/api/nodes/enroll", json={"join_token": "j" * 32, "name": "auto-01", "capacity": 3, "platforms": ["ps2"]})
    assert r2.json()["rejoined"] and r2.json()["id"] == r.json()["id"] and r2.json()["token"] != r.json()["token"]

    h = _admin(client)
    nid = r.json()["id"]
    with client.websocket_connect(f"/ws/agent?token={r2.json()['token']}") as ws:
        ws.send_json({"type": "hello", "gpu": "cpu", "capacity": 3, "platforms": ["ps2"], "inventory": [], "sessions": []})
        time.sleep(0.2)
        node = [n for n in client.get("/api/admin/nodes", headers=h).json() if n["id"] == nid][0]
        assert node["status"] == "online" and node["draining"] is False
        assert client.post(f"/api/admin/nodes/{nid}/drain", json={"on": True}, headers=h).json()["draining"] is True
        assert recv_until(ws, "drain")["on"] is True
        # un nodo drenando no recibe partidas
        import asyncio
        from app.db import SessionLocal
        from app.scheduler import pick_node

        async def pick():
            async with SessionLocal() as db:
                n = await pick_node(db, "ps2")
                return n.id if n else None

        assert asyncio.run(pick()) != nid
        # el propio agente puede pedir salir del drenaje
        ws.send_json({"type": "drain", "on": False})
        time.sleep(0.2)
        node = [n for n in client.get("/api/admin/nodes", headers=h).json() if n["id"] == nid][0]
        assert node["draining"] is False


def test_cloudflare_turn(monkeypatch):
    import asyncio
    from app import turn
    from app.config import settings
    from app.security import ice_servers

    fake = {"iceServers": [{"urls": "stun:stun.cloudflare.com:3478"}, {"urls": [
        "turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp"], "username": "u", "credential": "c"}]}
    monkeypatch.setattr(settings, "turn_provider", "cloudflare")
    monkeypatch.setattr(turn, "_fetch", lambda: turn._clean(fake["iceServers"]))
    assert asyncio.run(turn.refresh_once())
    s = ice_servers("user-x")
    assert s[0]["urls"] == ["stun:stun.cloudflare.com:3478"]
    assert all(":53" not in u for u in s[1]["urls"]) and s[1]["username"] == "u"
    turn._cache.update(servers=[], expires=0)


def test_session_options(client):
    """Wiimote real, micro, cámara y accesorios: se validan, se guardan con la sesión y llegan al agente."""
    tok = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "supersecret"}).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    node = client.post("/api/admin/nodes", json={"name": "acc-01", "capacity": 2}, headers=H).json()
    game = client.post("/api/admin/games", json={"title": "Party", "platform": "gc", "rom_path": "gc/party.iso"}, headers=H).json()
    with client.websocket_connect(f"/ws/agent?token={node['token']}") as agent:
        agent.send_json({"type": "hello", "gpu": "nvidia", "capacity": 2, "platforms": ["gc"], "inventory": [], "sessions": []})
        time.sleep(0.3)
        bad = client.post("/api/sessions", json={"game_id": game["id"], "options": {"accessories": ["lanzallamas"]}}, headers=H)
        assert bad.status_code == 422
        too_many = client.post("/api/sessions", json={"game_id": game["id"], "options": {
            "accessories": ["gc_bongos", "gc_mic", "gc_keyboard", "gc_dancemat", "singstar"]}}, headers=H)
        assert too_many.status_code == 422
        opts = {"wii_real": False, "mic": True, "camera": False, "accessories": ["gc_bongos", "gc_mic"]}
        r = client.post("/api/sessions", json={"game_id": game["id"], "options": opts}, headers=H)
        assert r.status_code == 201, r.text
        assert r.json()["options"] == opts
        start = recv_until(agent, "start")
        assert start["options"] == opts
        assert client.get(f"/api/sessions/{r.json()['id']}", headers=H).json()["options"] == opts
        client.delete(f"/api/sessions/{r.json()['id']}", headers=H)


def _lan_state(ws, want=None, limit=8):
    import json as _j
    for _ in range(limit):
        m = _j.loads(ws.receive_text())
        if m.get("t") == "lan" and (want is None or m.get("state") == want):
            return m
    raise AssertionError(f"no llegó el estado LAN {want}")


def test_lan_rooms(client):
    """Código compartido: dos consolas en la misma sala se ven como en una LAN; la sala se destruye al salir."""
    import asyncio as _a
    tok = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "supersecret"}).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    node = client.post("/api/admin/nodes", json={"name": "lan-01", "capacity": 4}, headers=H).json()
    game = client.post("/api/admin/games", json={"title": "GT", "platform": "ps2", "rom_path": "ps2/gt.iso"}, headers=H).json()
    with client.websocket_connect(f"/ws/agent?token={node['token']}") as agent:
        agent.send_json({"type": "hello", "gpu": "nvidia", "capacity": 4, "platforms": ["ps2"], "inventory": [], "sessions": []})
        time.sleep(0.3)
        # Sesiones que dejaron a medio cerrar las pruebas anteriores (cuentan para el límite del usuario)
        import sqlite3
        with sqlite3.connect("test.db") as db:
            db.execute("UPDATE sessions SET status = 'ended' WHERE status != 'ended'")
            db.execute("UPDATE nodes SET status = 'offline' WHERE name != 'lan-01'")  # que todo caiga en este nodo
        sess = []
        for _ in range(3):
            r = client.post("/api/sessions", json={"game_id": game["id"]}, headers=H)
            assert r.status_code == 201, r.text
            start = recv_until(agent, "start")
            sess.append((start["session_id"], start["worker_token"]))

        # Token incorrecto: fuera
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/lan/{sess[0][0]}?token=nope") as w:
                w.receive_text()

        a = client.websocket_connect(f"/ws/lan/{sess[0][0]}?token={sess[0][1]}").__enter__()
        b = client.websocket_connect(f"/ws/lan/{sess[1][0]}?token={sess[1][1]}").__enter__()
        c = client.websocket_connect(f"/ws/lan/{sess[2][0]}?token={sess[2][1]}").__enter__()
        a.send_text('{"t": "join", "code": "zz"}')
        assert _lan_state(a, "off")["error"] == "Código no válido"
        a.send_text('{"t": "join", "code": "k7q-2mx"}')
        st = _lan_state(a, "waiting")
        assert st["code"] == "K7Q2MX" and st["slot"] == 1 and st["members"] == 1
        b.send_text('{"t": "join", "code": "K7Q 2MX"}')
        assert _lan_state(b, "on")["slot"] == 2
        assert _lan_state(a, "on")["members"] == 2
        c.send_text('{"t": "join", "code": "ABCDEF"}')  # otra sala
        _lan_state(c, "waiting")

        mac_a, mac_b = bytes.fromhex("020000000001"), bytes.fromhex("020000000002")
        bcast = b"\xff" * 6 + mac_a + b"\x08\x06" + b"arp-who-has" + bytes(30)
        a.send_bytes(bcast)
        assert b.receive_bytes() == bcast  # broadcast: llega al otro de la sala
        uni = mac_a + mac_b + b"\x08\x00" + b"hola" + bytes(40)
        b.send_bytes(uni)
        assert a.receive_bytes() == uni  # unicast a la MAC que aprendió el switch
        big = bytes(2000)
        a.send_bytes(big)  # trama demasiado grande: se descarta
        a.send_bytes(mac_b + mac_a + b"\x08\x00" + bytes(46))
        assert b.receive_bytes()[:6] == mac_b  # la siguiente sí llega (la grande no)

        # La otra sala no ha visto nada: su primer mensaje sigue siendo de estado
        c.send_text('{"t": "leave"}')
        assert _lan_state(c, "off")["state"] == "off"

        b.send_text('{"t": "leave"}')
        _lan_state(b, "off")
        assert _lan_state(a, "waiting")["members"] == 1
        a.close(); b.close(); c.close()
        time.sleep(0.3)
        for sid, _t in sess:
            client.delete(f"/api/sessions/{sid}", headers=H)


def test_lan_room_destroyed(client):
    """Con la última consola fuera no queda nada de la sala en Redis."""
    import asyncio as _a
    from app import lan
    r = fakeredis.FakeAsyncRedis(decode_responses=True)

    async def go():
        await r.hset("lanroom:ps2:AAAAAA", "x", '{"slot": 1}')
        await r.hdel("lanroom:ps2:AAAAAA", "x")
        return await r.exists("lanroom:ps2:AAAAAA")

    assert _a.run(go()) == 0
    assert lan.normalize_code("k7q-2mx") == "K7Q2MX"
    assert lan.normalize_code("K0Q2MX") is None  # 0 no está en el alfabeto
    assert lan.normalize_code(None) is None
    assert not lan.ROOMS, "las salas de la réplica se destruyen cuando no queda nadie"
