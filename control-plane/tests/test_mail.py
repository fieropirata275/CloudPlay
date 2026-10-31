"""Correo de CloudPlay con un Resend y un SMTP falsos: bienvenida, recuperar la contraseña, demo, nodo caído,
ajustes del panel, prueba, vista previa y registro. Comparte la base de datos de prueba con test_e2e."""
import json
import os
import re
import socketserver
import threading
import time
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("CP_DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("CP_ADMIN_EMAIL", "admin@test.local")
os.environ.setdefault("CP_ADMIN_PASSWORD", "supersecret")
os.environ.setdefault("CP_PUBLIC_URL", "http://testserver")

import fakeredis  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import bus  # noqa: E402
from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

# ------------------------------------------------------------------ Resend falso
SENT: list[dict] = []
RESEND = {"fail": False}


class FakeResend(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        data = json.loads(self.rfile.read(n) or b"{}")
        assert self.headers["Authorization"] == "Bearer re_test"
        if self.path == "/emails":
            if RESEND["fail"]:
                return self._json(422, {"name": "validation_error", "message": "The from domain is not verified"})
            SENT.append(data)
            return self._json(200, {"id": f"em_{len(SENT)}"})
        if self.path == "/domains/dom1/verify":
            return self._json(200, {"object": "domain", "id": "dom1"})
        self._json(404, {})

    def do_GET(self):
        if self.path == "/domains/dom1":
            return self._json(200, {"id": "dom1", "name": "play.example.com", "status": "verified", "records": [
                {"record": "DKIM", "name": "resend._domainkey", "type": "TXT", "value": "p=MIG", "status": "verified"}]})
        self._json(404, {})


# ------------------------------------------------------------------ SMTP falso (sin TLS)
SMTP_INBOX: list[str] = []


class FakeSMTP(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: self.wfile.write((s + "\r\n").encode())  # noqa: E731
        w("220 fake ESMTP")
        while True:
            line = self.rfile.readline().decode(errors="replace").strip()
            if not line:
                return
            cmd = line.split(" ")[0].upper()
            if cmd in ("EHLO", "HELO"):
                w("250-fake")
                w("250 AUTH PLAIN")
            elif cmd == "AUTH":
                w("235 ok")
            elif cmd == "DATA":
                w("354 go")
                buf = []
                while True:
                    l2 = self.rfile.readline().decode(errors="replace")
                    if l2.rstrip("\r\n") == ".":
                        break
                    buf.append(l2)
                SMTP_INBOX.append("".join(buf))
                w("250 queued")
            elif cmd == "QUIT":
                w("221 bye")
                return
            else:
                w("250 ok")


@pytest.fixture(scope="module")
def client():
    bus.set_client(fakeredis.FakeAsyncRedis(decode_responses=True))
    srv = HTTPServer(("127.0.0.1", 0), FakeResend)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    smtp = socketserver.ThreadingTCPServer(("127.0.0.1", 0), FakeSMTP)
    smtp.daemon_threads = True
    threading.Thread(target=smtp.serve_forever, daemon=True).start()
    with TestClient(app) as c:
        c.resend_url = f"http://127.0.0.1:{srv.server_address[1]}"
        c.smtp_port = smtp.server_address[1]
        yield c
    srv.shutdown()
    smtp.shutdown()


def wait_sent(n, timeout=5.0):
    t = time.time() + timeout
    while len(SENT) < n and time.time() < t:
        time.sleep(0.05)
    assert len(SENT) >= n, f"esperaba {n} correos, hay {len(SENT)}"


def login(c, email, password):
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def use_resend(c):
    settings.mail_provider, settings.resend_api_key, settings.resend_api_base = "resend", "re_test", c.resend_url
    settings.mail_from, settings.resend_domain_id = "CloudPlay <no-reply@play.example.com>", "dom1"


def test_mail(client):
    c = client
    H = login(c, "admin@test.local", "supersecret")

    # Sin correo configurado: no se ofrece recuperar la contraseña y no sale nada
    saved = (settings.mail_provider, settings.mail_from)
    settings.mail_provider = ""
    assert c.get("/api/auth/options").json()["password_reset"] is False
    r = c.post("/api/auth/forgot", json={"email": "admin@test.local"})
    assert r.json() == {"ok": True, "mail": False}
    assert c.post("/api/admin/mail/test", json={}, headers=H).status_code == 409
    del saved

    use_resend(c)
    assert c.get("/api/auth/options").json()["password_reset"] is True

    # Bienvenida al crear un usuario desde el panel
    r = c.post("/api/admin/users", json={"email": "Jugador@Ejemplo.com", "password": "contraseña1"}, headers=H)
    assert r.status_code == 201, r.text
    wait_sent(1)
    assert SENT[0]["to"] == ["jugador@ejemplo.com"] and SENT[0]["subject"] == "Bienvenido a CloudPlay"
    assert SENT[0]["from"] == "CloudPlay <no-reply@play.example.com>" and "<html" in SENT[0]["html"] and SENT[0]["text"]

    # Recuperar la contraseña: enlace de un solo uso
    r = c.post("/api/auth/forgot", json={"email": "jugador@ejemplo.com"})
    assert r.json() == {"ok": True, "mail": True}
    wait_sent(2)
    reset_mail = SENT[1]
    assert reset_mail["subject"].startswith("Recupera tu contraseña")
    token = re.search(r"#/reset\?token=([\w-]+)", reset_mail["text"]).group(1)
    assert c.post("/api/auth/reset", json={"token": token, "password": "nuevaclave9"}).status_code == 200
    login(c, "jugador@ejemplo.com", "nuevaclave9")
    assert c.post("/api/auth/reset", json={"token": token, "password": "otra-clave"}).status_code == 410
    wait_sent(3)
    assert SENT[2]["subject"] == "Tu contraseña de CloudPlay ha cambiado"

    # Cuenta que no existe: misma respuesta y nada enviado
    before = len(SENT)
    assert c.post("/api/auth/forgot", json={"email": "nadie@ejemplo.com"}).json() == {"ok": True, "mail": True}
    time.sleep(0.3)
    assert len(SENT) == before
    # Límite de intentos por cuenta
    for _ in range(2):
        c.post("/api/auth/forgot", json={"email": "jugador@ejemplo.com"})
    assert c.post("/api/auth/forgot", json={"email": "jugador@ejemplo.com"}).status_code == 429
    wait_sent(before + 2)

    # Solicitud de demo: confirmación al que la pide y aviso al NOC (por defecto, todos los administradores)
    n0 = len(SENT)
    r = c.post("/api/leads", json={"name": "Ana <b>García</b>", "email": "ana@bar.com", "company": "Bar Retro", "players": "4"})
    assert r.status_code == 201
    wait_sent(n0 + 2)
    by_to = {tuple(m["to"]): m for m in SENT[n0:]}
    assert by_to[("ana@bar.com",)]["subject"] == "Hemos recibido tu solicitud de demo"
    noc = by_to[("admin@test.local",)]
    assert noc["subject"] == "Nueva solicitud de demo: Ana <b>García</b>"
    assert "&lt;b&gt;García" in noc["html"] and "<b>García" not in noc["html"]  # sin inyectar HTML

    # Panel: desactivar la bienvenida, avisar a otra dirección y responder a otra
    r = c.put("/api/admin/mail", json={"types": {"welcome": False, "reset": False}, "notify": ["NOC@empresa.com"],
                                        "reply_to": "soporte@empresa.com", "sender_name": "CloudPlay Bar"}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["types"]["welcome"] is False and r.json()["notify"] == ["noc@empresa.com"]
    assert c.put("/api/admin/mail", json={"notify": ["sin-arroba"]}, headers=H).status_code == 422
    n0 = len(SENT)
    c.post("/api/admin/users", json={"email": "otro@ejemplo.com", "password": "contraseña1"}, headers=H)
    c.post("/api/auth/forgot", json={"email": "otro@ejemplo.com"})  # recuperar la contraseña no se puede apagar
    wait_sent(n0 + 1)
    time.sleep(0.3)
    assert [m["subject"][:8] for m in SENT[n0:]] == ["Recupera"]
    assert SENT[-1]["from"] == "CloudPlay Bar <no-reply@play.example.com>" and SENT[-1]["reply_to"] == "soporte@empresa.com"

    st = c.get("/api/admin/mail", headers=H).json()
    assert st["configured"] and st["provider"] == "resend" and st["domain"]["status"] == "verified"
    assert st["recipients"] == ["noc@empresa.com"]
    kinds = {k["kind"]: k for k in st["kinds"]}
    assert kinds["reset"]["locked"] and not kinds["welcome"]["locked"]
    assert any(l["kind"] == "welcome" and l["status"] == "skipped" for l in st["log"])
    assert c.post("/api/admin/mail/verify", headers=H).json()["status"] == "verified"
    prev = c.get("/api/admin/mail/preview/node_down", headers=H).json()
    assert prev["subject"] == "Nodo caído: cloudplay-node-201" and "<html" in prev["html"]

    # Prueba desde el panel, y un error del proveedor se ve claro
    assert c.post("/api/admin/mail/test", json={"to": "yo@empresa.com"}, headers=H).json() == {"ok": True, "to": "yo@empresa.com"}
    RESEND["fail"] = True
    r = c.post("/api/admin/mail/test", json={}, headers=H)
    assert r.status_code == 502 and "not verified" in r.json()["detail"]
    RESEND["fail"] = False
    assert c.get("/api/admin/mail", headers=H).json()["log"][0]["status"] == "failed"

    # Nodo caído: un aviso al NOC (y no otro mientras parpadea)
    from app.db import SessionLocal
    from app.models import Node, now
    from app.reaper import reap_once

    async def make_dead():
        async with SessionLocal() as db:
            db.add(Node(name="nodo-mail", token_hash="x", status="online", last_seen=now() - timedelta(minutes=5)))
            await db.commit()

    n0 = len(SENT)
    c.portal.call(make_dead)
    c.portal.call(reap_once)
    wait_sent(n0 + 1)
    assert SENT[-1]["subject"] == "Nodo caído: nodo-mail" and SENT[-1]["to"] == ["noc@empresa.com"]

    # SMTP (Gmail, Brevo, SES, Mailgun…): multiparte texto + HTML
    settings.mail_provider, settings.smtp_host, settings.smtp_port = "smtp", "127.0.0.1", c.smtp_port
    settings.smtp_security, settings.smtp_user, settings.smtp_password = "none", "u", "p"
    r = c.post("/api/admin/mail/test", json={"to": "smtp@empresa.com"}, headers=H)
    assert r.status_code == 200, r.text
    raw = SMTP_INBOX[-1]
    assert "To: smtp@empresa.com" in raw and "multipart/alternative" in raw and "text/html" in raw
    assert c.get("/api/admin/mail", headers=H).json()["smtp"] == f"127.0.0.1:{c.smtp_port}"

    # Sistema: cómo se llega a la plataforma
    s = c.get("/api/admin/system", headers=H).json()
    assert set(s) >= {"exposure", "public_url", "lan_url", "turn", "mail"}
    settings.mail_provider = ""


def test_users_admin(client):
    """Usuarios desde el panel: crear, cambiar, mandar el enlace de contraseña y borrar"""
    c = client
    use_resend(c)
    H = login(c, "admin@test.local", "supersecret")
    me = c.get("/api/auth/me", headers=H).json()
    r = c.post("/api/admin/users", json={"email": "Nuevo@Bar.com", "password": "contraseña1", "max_sessions": 2}, headers=H)
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    assert c.post("/api/admin/users", json={"email": "sinarroba", "password": "contraseña1"}, headers=H).status_code == 422
    assert c.post("/api/admin/users", json={"email": "nuevo@bar.com", "password": "contraseña1"}, headers=H).status_code == 409
    users = {u["email"]: u for u in c.get("/api/admin/users", headers=H).json()}
    assert users["nuevo@bar.com"]["max_sessions"] == 2 and users["nuevo@bar.com"]["created_at"]
    r = c.patch(f"/api/admin/users/{uid}", json={"is_admin": True, "password": "otra-clave-1"}, headers=H)
    assert r.json()["is_admin"] is True
    login(c, "nuevo@bar.com", "otra-clave-1")
    assert c.patch(f"/api/admin/users/{me['id']}", json={"is_admin": False}, headers=H).status_code == 409
    n0 = len(SENT)
    assert c.post(f"/api/admin/users/{uid}/reset", headers=H).json() == {"ok": True}
    wait_sent(n0 + 1)
    assert any(m["subject"].startswith("Recupera") and m["to"] == ["nuevo@bar.com"] for m in SENT[n0:])
    assert c.delete(f"/api/admin/users/{me['id']}", headers=H).status_code == 409
    assert c.delete(f"/api/admin/users/{uid}", headers=H).json() == {"ok": True}
    assert c.post("/api/auth/login", json={"email": "nuevo@bar.com", "password": "otra-clave-1"}).status_code == 401
    settings.mail_provider = ""
    assert c.post(f"/api/admin/users/{me['id']}/reset", headers=H).status_code == 409
