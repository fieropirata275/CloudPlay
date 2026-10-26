"""Agente de nodo worker.

- Mantiene un WebSocket con el control plane (/ws/agent): hello + heartbeats + estado de sesiones.
- Lanza un contenedor de sesión por partida (docker.sock), con GPU, uinput y slot de puertos/display.
- Descarga las partidas guardadas del usuario del S3 (SeaweedFS o cualquier S3) antes de arrancar y las sube al terminar.
- Al arrancar adopta los contenedores de sesión que siguieran vivos (reinicio del agente sin cortar partidas).
- Alta automática con JOIN_TOKEN (plantillas de Proxmox, ISO, Kubernetes): pide su propio token y lo guarda.
- Drenaje: con DATA_DIR/drain presente no recibe partidas nuevas (mantenimiento, SAI con batería baja...).
- Autoguardado: sube cada AUTOSAVE_INTERVAL s una copia de las partidas, por si se va la luz a mitad de partida.
"""
import asyncio
import io
import json
import logging
import os
import shutil
import signal
import socket
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import docker
import websockets
from docker.types import DeviceRequest
from minio import Minio
from minio.error import S3Error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s agent: %(message)s")
log = logging.getLogger()

E = os.environ
CP_URL = E["CP_URL"].rstrip("/")  # wss://play.example.com
NODE_TOKEN = E.get("NODE_TOKEN", "").strip()
JOIN_TOKEN = E.get("JOIN_TOKEN", "").strip()
NODE_NAME = E.get("NODE_NAME", "").strip() or socket.gethostname()
AUTOSAVE_INTERVAL = int(E.get("AUTOSAVE_INTERVAL", "300"))
CAPACITY = int(E.get("CAPACITY", "2"))
PLATFORMS = [p.strip() for p in E.get("PLATFORMS", "ps2,gc,wii").split(",") if p.strip()]
GPU = E.get("GPU", "nvidia")  # nvidia | vaapi | cpu
NVIDIA_GPUS = [g for g in E.get("NVIDIA_GPUS", "0").split(",") if g]
DRI_NODES = [d for d in E.get("DRI_NODES", "/dev/dri/renderD128").split(",") if d]
SESSION_IMAGE = E.get("SESSION_IMAGE", "cloudplay/session:latest")
LIBRARY_DIR = E.get("LIBRARY_DIR", "/srv/cloudplay/library")  # ruta del HOST
BIOS_DIR = E.get("BIOS_DIR", "/srv/cloudplay/bios")  # ruta del HOST
DATA_DIR = Path(E.get("DATA_DIR", "/var/lib/cloudplay"))  # misma ruta dentro y fuera
ICE_PORT_BASE = int(E.get("ICE_PORT_BASE", "40000"))
ICE_PORTS_PER_SLOT = int(E.get("ICE_PORTS_PER_SLOT", "20"))
RESOLUTION = E.get("RESOLUTION", "1280x720")
SESSION_CPUS = float(E.get("SESSION_CPUS", "4"))
SESSION_MEM = E.get("SESSION_MEM", "6g")
IDLE_TIMEOUT = E.get("IDLE_TIMEOUT", "180")
MAX_PADS = E.get("MAX_PADS", "2")
EXTRA_ENV = json.loads(E.get("SESSION_EXTRA_ENV", "{}"))

S3_ENDPOINT = E.get("S3_ENDPOINT", "")
S3_BUCKET = E.get("S3_BUCKET", "cloudplay-saves")
SAVE_GROUP = {"ps2": "ps2", "gc": "dolphin", "wii": "dolphin"}  # GC y Wii comparten usuario de Dolphin

ROM_EXT = {
    "ps2": {".iso", ".chd", ".cso", ".zso", ".bin", ".gz"},
    "gc": {".iso", ".gcm", ".ciso", ".gcz", ".rvz"},
    "wii": {".iso", ".wbfs", ".rvz", ".gcz", ".wia"},
}
LABEL = "cloudplay.session"

dk = docker.from_env()
s3: Minio | None = None


def init_s3(endpoint: str, access_key: str | None, secret_key: str | None, bucket: str | None = None) -> None:
    """S3 de partidas: de worker.env o, si no está ahí, el que entrega el orquestador al dar de alta el nodo."""
    global s3, S3_BUCKET
    if not endpoint:
        return
    s3 = Minio(endpoint.split("://")[-1], access_key=access_key, secret_key=secret_key, secure=endpoint.startswith("https"))
    if bucket:
        S3_BUCKET = bucket
    log.info("partidas guardadas en %s/%s", endpoint, S3_BUCKET)


init_s3(S3_ENDPOINT, E.get("S3_ACCESS_KEY"), E.get("S3_SECRET_KEY"))


def blocking(fn, *a, **kw):
    return asyncio.get_running_loop().run_in_executor(None, lambda: fn(*a, **kw))


# ------------------------------------------------------------------ catálogo
SYSTEM_PATH = "@system"  # ruta virtual: arrancar la consola sin juego (menú del sistema)
SYSTEM_TITLE = {
    "ps2": "PlayStation 2 · Navegador del sistema",
    "gc": "GameCube · Menú principal",
    "wii": "Wii · Menú del sistema",
}


def system_firmware(plat: str, bios: Path = Path("/bios")) -> bool:
    """¿Hay firmware para arrancar la consola sin juego? Tiene que volcarlo cada empresa de sus consolas."""
    try:
        if plat == "ps2":
            return any(f.suffix.lower() == ".bin" for f in (bios / "ps2").iterdir() if f.is_file())
        if plat == "gc":
            return any((bios / "gc" / r / "IPL.bin").is_file() for r in ("EUR", "USA", "JAP"))
        if plat == "wii":
            return (bios / "wii" / "title" / "00000001" / "00000002" / "content").is_dir()
    except OSError:
        pass
    return False


def scan_library() -> list[dict]:
    """La librería debe tener carpetas por plataforma: library/ps2, library/gc, library/wii."""
    root = Path("/library")
    out = [
        {"platform": p, "path": f"{p}/{SYSTEM_PATH}", "title": SYSTEM_TITLE[p]}
        for p in PLATFORMS
        if p in SYSTEM_TITLE and system_firmware(p)
    ]
    for plat in PLATFORMS:
        d = root / plat
        if not d.is_dir():
            continue
        for f in sorted(d.rglob("*")):
            if f.is_file() and f.suffix.lower() in ROM_EXT.get(plat, ()):
                out.append({"platform": plat, "path": f.relative_to(root).as_posix()})
    return out


# ------------------------------------------------------------------- saves
def _save_key(user_id: str, platform: str, auto: bool = False) -> str:
    return f"{user_id}/{SAVE_GROUP[platform]}{'.autosave' if auto else ''}.tar.gz"


def _newest_key(user_id: str, platform: str) -> str:
    """La copia normal se sube al cerrar la partida; la autoguardada, durante. Si la autoguardada es más
    nueva es que la última partida no terminó bien (apagón, nodo caído): se recupera desde ahí."""
    best, when = _save_key(user_id, platform), None
    for key in (_save_key(user_id, platform), _save_key(user_id, platform, auto=True)):
        try:
            t = s3.stat_object(S3_BUCKET, key).last_modified
        except S3Error:
            continue
        if when is None or t > when:
            best, when = key, t
    return best


def download_saves(user_id: str, platform: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    if s3 is not None:
        try:
            resp = s3.get_object(S3_BUCKET, _newest_key(user_id, platform))
            try:
                data = resp.read()
            finally:
                resp.close()
                resp.release_conn()
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                tar.extractall(dest, filter="data")  # sin rutas absolutas ni ../
            log.info("partidas restauradas para %s/%s", user_id, platform)
        except S3Error as e:
            if e.code != "NoSuchKey":
                raise
    for p in [dest, *dest.rglob("*")]:
        os.chown(p, 1000, 1000)


def upload_saves(user_id: str, platform: str, src: Path, auto: bool = False) -> None:
    if s3 is None or not src.exists():
        return
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for child in src.iterdir():
            tar.add(child, arcname=child.name)
    size = buf.tell()
    buf.seek(0)
    if not s3.bucket_exists(S3_BUCKET):
        s3.make_bucket(S3_BUCKET)
    s3.put_object(S3_BUCKET, _save_key(user_id, platform, auto), buf, size, content_type="application/gzip")
    log.info("partidas %s para %s/%s (%d KB)", "autoguardadas" if auto else "subidas", user_id, platform, size // 1024)


# --------------------------------------------------------- alta automática
TOKEN_FILE = DATA_DIR / "node.token"
CONFIG_FILE = DATA_DIR / "node.json"
DRAIN_FILE = DATA_DIR / "drain"
STATUS_FILE = DATA_DIR / "status.json"


def enroll() -> str:
    """Pide al control plane un token propio para este nodo usando el token de unión compartido."""
    base = CP_URL.replace("wss://", "https://").replace("ws://", "http://")
    body = json.dumps({"join_token": JOIN_TOKEN, "name": NODE_NAME, "capacity": CAPACITY, "platforms": PLATFORMS}).encode()
    req = urllib.request.Request(f"{base}/api/nodes/enroll", data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = json.loads(r.read())
    token = resp["token"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(token)
    os.chmod(TOKEN_FILE, 0o600)
    CONFIG_FILE.write_text(json.dumps({"s3": resp.get("s3")}))
    os.chmod(CONFIG_FILE, 0o600)
    apply_node_config()
    log.info("nodo dado de alta como %s", NODE_NAME)
    return token


def apply_node_config() -> None:
    if S3_ENDPOINT or not CONFIG_FILE.exists():
        return  # lo de worker.env manda
    try:
        cfg = json.loads(CONFIG_FILE.read_text()).get("s3") or {}
    except ValueError:
        return
    if cfg.get("endpoint"):
        init_s3(cfg["endpoint"], cfg.get("access_key"), cfg.get("secret_key"), cfg.get("bucket"))


def node_token(force_enroll: bool = False) -> str:
    if NODE_TOKEN and not force_enroll:
        return NODE_TOKEN
    if TOKEN_FILE.exists() and not force_enroll:
        apply_node_config()
        return TOKEN_FILE.read_text().strip()
    if not JOIN_TOKEN:
        raise SystemExit("Falta NODE_TOKEN o JOIN_TOKEN en worker.env")
    while True:
        try:
            return enroll()
        except urllib.error.HTTPError as e:
            if e.code in (401, 404):
                raise SystemExit(f"El control plane rechaza el alta ({e.code}): revisa JOIN_TOKEN y CP_JOIN_TOKEN") from e
            log.warning("alta fallida (%s), reintento en 15 s", e.code)
        except Exception as e:  # noqa: BLE001
            log.warning("control plane inalcanzable para el alta (%s), reintento en 15 s", e)
        time.sleep(15)


# ----------------------------------------------------------------- agente
class Agent:
    def __init__(self):
        self.ws = None
        self.token = node_token()
        self.drain_sent: bool | None = None
        self.last_autosave: dict[str, float] = {}
        self.slots: dict[int, str] = {}  # slot -> session_id
        self.meta: dict[str, dict] = {}  # session_id -> {user_id, platform, slot}
        self.stopping: set[str] = set()
        self.adopt_existing()

    def adopt_existing(self) -> None:
        for c in dk.containers.list(all=True, filters={"label": LABEL}):
            sid = c.labels[LABEL]
            slot = int(c.labels.get("cloudplay.slot", "-1"))
            self.slots[slot] = sid
            self.meta[sid] = {"user_id": c.labels.get("cloudplay.user"), "platform": c.labels.get("cloudplay.platform"), "slot": slot}
            log.info("adoptada sesión existente %s (slot %d)", sid, slot)

    async def send(self, msg: dict) -> None:
        if self.ws is not None:
            try:
                await self.ws.send(json.dumps(msg))
            except websockets.ConnectionClosed:
                pass

    async def state(self, sid: str, status: str, error: str | None = None) -> None:
        await self.send({"type": "session_state", "session_id": sid, "status": status, "error": error})

    # ------------------------------------------------------- sesiones
    def _gpu_kwargs(self, slot: int) -> dict:
        if GPU == "nvidia":
            gpu = NVIDIA_GPUS[slot % len(NVIDIA_GPUS)]
            return {
                "device_requests": [DeviceRequest(device_ids=[gpu], capabilities=[["gpu", "video", "graphics", "compute", "utility"]])],
                "env": {"ENCODER": "nvidia", "VGL_DISPLAY": "egl"},
                "devices": [],
            }
        if GPU == "vaapi":
            node = DRI_NODES[slot % len(DRI_NODES)]
            return {"device_requests": [], "env": {"ENCODER": "vaapi", "VGL_DISPLAY": node}, "devices": [f"{node}:{node}:rwm"]}
        return {"device_requests": [], "env": {"ENCODER": "x264", "USE_VGL": "0"}, "devices": []}

    def _run_container(self, msg: dict, slot: int, saves: Path):
        sid = msg["session_id"]
        g = self._gpu_kwargs(slot)
        port_lo = ICE_PORT_BASE + slot * ICE_PORTS_PER_SLOT
        env = {
            "SESSION_ID": sid,
            "WORKER_TOKEN": msg["worker_token"],
            "SIGNAL_URL": msg["signal_url"],
            "ICE_SERVERS": json.dumps(msg.get("ice_servers", [])),
            "PLATFORM": msg["platform"],
            "ROM": f"/library/{msg['rom_path']}",
            "DISPLAY_NUM": str(100 + slot),
            "ICE_PORT_MIN": str(port_lo),
            "ICE_PORT_MAX": str(port_lo + ICE_PORTS_PER_SLOT - 1),
            "RESOLUTION": RESOLUTION,
            "IDLE_TIMEOUT": IDLE_TIMEOUT,
            "MAX_PADS": MAX_PADS,
            # Wiimote real, micro, cámara y accesorios que trae el jugador (los valida el orquestador)
            "SESSION_OPTIONS": json.dumps(msg.get("options") or {}),
            **g["env"],
            **EXTRA_ENV,
        }
        return dk.containers.run(
            SESSION_IMAGE,
            name=f"cloudplay-{sid}",
            detach=True,
            labels={LABEL: sid, "cloudplay.user": msg["user_id"], "cloudplay.platform": msg["platform"], "cloudplay.slot": str(slot)},
            environment=env,
            # Red del host: WebRTC sin NAT de Docker. El rango ICE por slot permite un firewall estrecho.
            network_mode="host",
            volumes={
                LIBRARY_DIR: {"bind": "/library", "mode": "ro"},
                BIOS_DIR: {"bind": "/bios", "mode": "ro"},
                str(saves): {"bind": "/saves", "mode": "rw"},
            },
            devices=["/dev/uinput:/dev/uinput:rwm", *g["devices"]],
            device_cgroup_rules=["c 13:* rmw"],  # nodos /dev/input/event* creados dentro
            device_requests=g["device_requests"] or None,
            cap_drop=["ALL"],
            cap_add=["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "MKNOD"],
            security_opt=["no-new-privileges"],
            shm_size="1g",
            mem_limit=SESSION_MEM,
            nano_cpus=int(SESSION_CPUS * 1e9),
            pids_limit=1024,
            log_config={"type": "json-file", "config": {"max-size": "10m", "max-file": "2"}},
        )

    async def start(self, msg: dict) -> None:
        sid = msg["session_id"]
        if sid in self.meta:
            return
        if msg.get("platform") not in PLATFORMS:
            await self.state(sid, "failed", "Plataforma no soportada en este nodo")
            return
        slot = next((i for i in range(CAPACITY) if i not in self.slots), None)
        if slot is None:
            await self.state(sid, "failed", "Nodo lleno")
            return
        self.slots[slot] = sid
        self.meta[sid] = {"user_id": msg["user_id"], "platform": msg["platform"], "slot": slot, "starting": True}
        saves = DATA_DIR / "sessions" / sid / "saves"
        try:
            await blocking(download_saves, msg["user_id"], msg["platform"], saves)
            await blocking(self._run_container, msg, slot, saves)
            self.meta[sid].pop("starting", None)
            log.info("sesión %s arrancada en slot %d (%s)", sid, slot, msg.get("title"))
            await self.state(sid, "running")
        except Exception as e:  # noqa: BLE001
            log.exception("no se pudo arrancar %s", sid)
            self.slots.pop(slot, None)
            self.meta.pop(sid, None)
            await self.state(sid, "failed", f"Error arrancando: {e}")

    async def stop(self, sid: str) -> None:
        self.stopping.add(sid)
        try:
            c = await blocking(dk.containers.get, f"cloudplay-{sid}")
            await blocking(c.stop, timeout=20)
        except docker.errors.NotFound:
            pass

    async def reap(self) -> None:
        """Detecta contenedores terminados: sube partidas, limpia y avisa."""
        containers = await blocking(dk.containers.list, all=True, filters={"label": LABEL})
        for c in containers:
            sid = c.labels[LABEL]
            if c.status in ("running", "created", "restarting"):
                continue
            code = c.attrs.get("State", {}).get("ExitCode", 0)
            tail = ""
            if code != 0 and sid not in self.stopping:
                tail = (await blocking(c.logs, tail=15)).decode(errors="replace")[-1500:]
            meta = self.meta.get(sid) or {"user_id": c.labels.get("cloudplay.user"), "platform": c.labels.get("cloudplay.platform")}
            saves = DATA_DIR / "sessions" / sid / "saves"
            try:
                await blocking(upload_saves, meta["user_id"], meta["platform"], saves)
            except Exception:  # noqa: BLE001
                log.exception("fallo subiendo partidas de %s (se conservan en %s)", sid, saves)
            else:
                shutil.rmtree(saves.parent, ignore_errors=True)
            await blocking(c.remove, force=True)
            self._forget(sid)
            ok = code == 0 or sid in self.stopping
            self.stopping.discard(sid)
            log.info("sesión %s terminada (exit %s)", sid, code)
            await self.state(sid, "ended" if ok else "failed", None if ok else f"exit {code}\n{tail}")
        # Sesiones que creemos vivas pero cuyo contenedor desapareció (borrado a mano, etc.)
        listed = {c.labels[LABEL] for c in containers}
        for sid in [s for s, m in self.meta.items() if s not in listed and not m.get("starting")]:
            self._forget(sid)
            self.stopping.discard(sid)
            await self.state(sid, "ended")

    def _forget(self, sid: str) -> None:
        m = self.meta.pop(sid, None)
        if m is not None:
            self.slots.pop(m["slot"], None)

    # ---------------------------------------------------------- bucle
    async def heartbeat(self) -> None:
        while True:
            await asyncio.sleep(10)
            await self.send({"type": "heartbeat", "sessions": list(self.meta)})
            await self.sync_drain()
            self.write_status()

    # ------------------------------------------------- drenaje y estado local
    async def sync_drain(self) -> None:
        """El fichero DATA_DIR/drain manda: `cloudplay node drain` lo crea, `cloudplay node resume` lo borra."""
        want = DRAIN_FILE.exists()
        if self.ws is not None and want != self.drain_sent:
            await self.send({"type": "drain", "on": want})
            self.drain_sent = want

    def write_status(self) -> None:
        try:
            STATUS_FILE.write_text(json.dumps({
                "name": NODE_NAME, "connected": self.ws is not None, "draining": DRAIN_FILE.exists(),
                "sessions": len(self.meta), "capacity": CAPACITY, "updated": int(time.time()),
            }))
        except OSError:
            pass

    async def autosave(self) -> None:
        """Copia periódica de las partidas en curso (a una clave aparte, la normal solo se toca al cerrar)."""
        if s3 is None or AUTOSAVE_INTERVAL <= 0:
            return
        t = time.time()
        for sid, m in list(self.meta.items()):
            if m.get("starting") or not m.get("user_id") or m.get("platform") not in SAVE_GROUP:
                continue
            if t - self.last_autosave.setdefault(sid, t) < AUTOSAVE_INTERVAL:
                continue
            self.last_autosave[sid] = t
            try:
                await blocking(upload_saves, m["user_id"], m["platform"], DATA_DIR / "sessions" / sid / "saves", True)
            except Exception:  # noqa: BLE001
                log.exception("autoguardado de %s", sid)

    async def reaper(self) -> None:
        while True:
            try:
                await self.reap()
                await self.autosave()
            except Exception:  # noqa: BLE001
                log.exception("reap")
            await asyncio.sleep(3)

    async def handle(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "start":
            asyncio.create_task(self.start(msg))
        elif t == "stop":
            asyncio.create_task(self.stop(msg.get("session_id", "")))
        elif t == "drain":
            # Drenado desde el panel: lo reflejamos en el fichero para que sobreviva a reinicios
            on = bool(msg.get("on", True))
            if on:
                DRAIN_FILE.touch()
            else:
                DRAIN_FILE.unlink(missing_ok=True)
            self.drain_sent = on

    async def run(self) -> None:
        asyncio.create_task(self.reaper())
        asyncio.create_task(self.heartbeat())
        backoff = 1
        while True:
            try:
                async with websockets.connect(f"{CP_URL}/ws/agent?token={self.token}", ping_interval=20, max_size=2**22) as ws:
                    self.ws, backoff = ws, 1
                    self.drain_sent = None
                    inventory = await blocking(scan_library)
                    await self.send({
                        "type": "hello", "gpu": GPU, "capacity": CAPACITY, "platforms": PLATFORMS,
                        "inventory": inventory, "sessions": list(self.meta),
                    })
                    log.info("conectado al control plane (%d juegos en librería)", len(inventory))
                    await self.sync_drain()
                    self.write_status()
                    async for raw in ws:
                        try:
                            await self.handle(json.loads(raw))
                        except ValueError:
                            pass
            except (websockets.InvalidStatusCode, websockets.InvalidStatus) as e:
                # 403 en el saludo: el token ya no vale (nodo borrado en el panel). Con JOIN_TOKEN nos damos de alta otra vez.
                code = getattr(e, "status_code", None) or getattr(getattr(e, "response", None), "status_code", None)
                if code == 403 and JOIN_TOKEN and not NODE_TOKEN:
                    log.warning("token rechazado: volviendo a dar de alta el nodo")
                    self.token = await blocking(node_token, True)
                else:
                    log.warning("conexión rechazada: %s (reintento en %ss)", e, backoff)
            except Exception as e:  # noqa: BLE001
                log.warning("conexión perdida: %s (reintento en %ss)", e, backoff)
            self.ws = None
            self.write_status()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


if __name__ == "__main__":
    # SIGTERM (docker stop, apagado): salimos sin tocar las partidas. Los contenedores de sesión siguen vivos
    # y el agente los adopta al volver; si el host se apaga, el autoguardado conserva el progreso.
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    asyncio.run(Agent().run())
