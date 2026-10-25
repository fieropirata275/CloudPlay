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
