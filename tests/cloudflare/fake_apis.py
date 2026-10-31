"""Cloudflare y Resend de mentira para probar `cloudplay cloudflare` y `cloudplay mail` sin cuentas reales.

    python3 fake_apis.py PUERTO      → http://127.0.0.1:PUERTO/cf/...  y  /resend/...   (estado en /_state)

Imita lo justo de sus APIs: zonas, túneles gestionados desde Cloudflare (rutas y token), registros DNS, claves TURN,
y en Resend dominios con sus registros, verificación (solo si los DNS están de verdad en el Cloudflare falso) y envíos.
"""
import json
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CF_TOKEN, RS_KEY = "cf-token", "re_key"
S = {
    "zones": [{"id": "z1", "name": "tudominio.com", "status": "active", "account": {"id": "acc1"}}],
    "tunnels": {}, "configs": {},
    # Lo que ya había en la zona: un A del nombre que vamos a usar (no se pisa sin --yes)
    "dns": {"r0": {"id": "r0", "type": "A", "name": "play.tudominio.com", "content": "203.0.113.7", "proxied": False}},
    "turn": {}, "domains": {}, "emails": [], "calls": [],
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def cf_ok(self, result):
        self._send(200, {"success": True, "errors": [], "messages": [], "result": result})

    def cf_err(self, code, msg, http=400):
        self._send(http, {"success": False, "errors": [{"code": code, "message": msg}], "result": None})

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def handle_any(self, method):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        p = u.path
        S["calls"].append(f"{method} {p}")
        if p == "/_state":
            return self._send(200, S)
        if p.startswith("/cf/"):
            if self.headers.get("Authorization") != f"Bearer {CF_TOKEN}":
                return self.cf_err(10000, "Authentication error", 403)
            return self.cf(method, p[3:], q)
        if p.startswith("/resend/"):
            if self.headers.get("Authorization") != f"Bearer {RS_KEY}":
                return self._send(401, {"name": "invalid_api_key", "message": "API key is invalid"})
            return self.resend(method, p[7:])
        self._send(404, {})

    # ---------------------------------------------------------------- Cloudflare
    def cf(self, m, p, q):
        parts = p.strip("/").split("/")
        if p == "/zones" and m == "GET":
            return self.cf_ok([z for z in S["zones"] if z["name"] == q.get("name")])
        if parts[:3] == ["accounts", "acc1", "cfd_tunnel"]:
            if len(parts) == 3 and m == "GET":
                return self.cf_ok([t for t in S["tunnels"].values() if t["name"] == q.get("name") and not t.get("deleted")])
            if len(parts) == 3 and m == "POST":
                b = self.body()
                assert b.get("config_src") == "cloudflare", b
                tid = str(uuid.uuid4())
                S["tunnels"][tid] = {"id": tid, "name": b["name"], "status": "inactive", "connections": []}
                return self.cf_ok({**S["tunnels"][tid], "token": f"eyJtoken-{tid[:8]}"})
            tid = parts[3]
            if tid not in S["tunnels"]:
                return self.cf_err(1003, "Tunnel not found", 404)
            if len(parts) == 5 and parts[4] == "token":
                return self.cf_ok(f"eyJtoken-{tid[:8]}")
            if len(parts) == 5 and parts[4] == "configurations" and m == "PUT":
                cfg = self.body()["config"]
                if cfg["ingress"][-1].get("hostname"):
                    return self.cf_err(1056, "the last ingress rule must be a catch-all")
                S["configs"][tid] = cfg
                S["tunnels"][tid].update(status="healthy", connections=[{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}])
                return self.cf_ok({"config": cfg})
            if len(parts) == 4 and m == "GET":
                return self.cf_ok(S["tunnels"][tid])
            if len(parts) == 4 and m == "DELETE":
                S["tunnels"][tid]["deleted"] = True
                return self.cf_ok(S["tunnels"][tid])
        if parts[:4] == ["accounts", "acc1", "calls", "turn_keys"]:
            if m == "POST":
                uid = uuid.uuid4().hex
                S["turn"][uid] = self.body().get("name")
                return self.cf_ok({"uid": uid, "key": f"turnkey-{uid[:6]}", "name": S["turn"][uid]})
            if m == "DELETE":
                S["turn"].pop(parts[4], None)
                return self.cf_ok({})
        if parts[:3] == ["zones", "z1", "dns_records"]:
            if len(parts) == 3 and m == "GET":
                rs = [r for r in S["dns"].values() if r["name"] == q.get("name") and (not q.get("type") or r["type"] == q["type"])]
                return self.cf_ok(rs)
            if len(parts) == 3 and m == "POST":
                b = self.body()
                rid = "r" + uuid.uuid4().hex[:8]
                S["dns"][rid] = {"id": rid, **b}
                return self.cf_ok(S["dns"][rid])
            rid = parts[3]
            if rid not in S["dns"]:
                return self.cf_err(81044, "Record does not exist", 404)
            if m == "PUT":
                S["dns"][rid] = {"id": rid, **self.body()}
                return self.cf_ok(S["dns"][rid])
            if m == "DELETE":
                S["dns"].pop(rid)
                return self.cf_ok({"id": rid})
        self.cf_err(7003, f"no route {m} {p}", 404)

    # ---------------------------------------------------------------- Resend
    def dns_has(self, typ, name, value):
        return any(r["type"] == typ and r["name"] == name and r["content"].strip('"') == value for r in S["dns"].values())

    def resend(self, m, p):
        parts = p.strip("/").split("/")
        if p == "/emails" and m == "POST":
            S["emails"].append(self.body())
            return self._send(200, {"id": f"em_{len(S['emails'])}"})
        if p == "/domains" and m == "GET":
            return self._send(200, {"object": "list", "data": [{k: d[k] for k in ("id", "name", "status", "region")}
                                                                for d in S["domains"].values()]})
        if p == "/domains" and m == "POST":
            b = self.body()
            did = str(uuid.uuid4())
            S["domains"][did] = {"id": did, "name": b["name"], "region": b.get("region", "us-east-1"), "status": "not_started",
                                 "records": [
                                     {"record": "DKIM", "name": "resend._domainkey", "type": "TXT", "value": "p=MIGfMA0GCSq", "ttl": "Auto", "status": "not_started"},
                                     {"record": "SPF", "name": "send", "type": "MX", "value": "feedback-smtp.eu-west-1.amazonses.com", "priority": 10, "ttl": "Auto", "status": "not_started"},
                                     {"record": "SPF", "name": "send", "type": "TXT", "value": "v=spf1 include:amazonses.com ~all", "ttl": "Auto", "status": "not_started"},
                                     {"record": "Tracking", "name": "links", "type": "CNAME", "value": "links1.resend-dns.com", "ttl": "Auto", "status": "not_started"}]}
            return self._send(201, S["domains"][did])
        if parts[0] == "domains" and len(parts) >= 2 and parts[1] in S["domains"]:
            d = S["domains"][parts[1]]
            if len(parts) == 3 and parts[2] == "verify" and m == "POST":
                d["status"] = "pending"
                return self._send(200, {"object": "domain", "id": d["id"]})
            if m == "GET":
                if d["status"] == "pending":
                    for r in d["records"]:
                        if r["record"] != "Tracking":
                            r["status"] = "verified" if self.dns_has(r["type"], f"{r['name']}.{d['name']}", r["value"]) else "pending"
                    if all(r["status"] == "verified" for r in d["records"] if r["record"] != "Tracking"):
                        d["status"] = "verified"
                return self._send(200, d)
        self._send(404, {"name": "not_found", "message": f"no route {m} {p}"})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PUT(self):
        self.handle_any("PUT")

    def do_DELETE(self):
        self.handle_any("DELETE")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
