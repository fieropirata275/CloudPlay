"""Agente de nodo worker.

- Mantiene un WebSocket con el control plane (/ws/agent): hello + heartbeats + estado de sesiones.
- Lanza un contenedor de sesión por partida (docker.sock), con GPU, uinput y slot de puertos/display.
- Descarga las partidas guardadas del usuario de MinIO antes de arrancar y las sube al terminar.
- Al arrancar adopta los contenedores de sesión que siguieran vivos (reinicio del agente sin cortar partidas).
"""
import asyncio
import io
import json
import logging
import os
import shutil
import tarfile
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
NODE_TOKEN = E["NODE_TOKEN"]
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
s3 = (
    Minio(
        S3_ENDPOINT.split("://")[-1],
        access_key=E.get("S3_ACCESS_KEY"),
        secret_key=E.get("S3_SECRET_KEY"),
        secure=S3_ENDPOINT.startswith("https"),
    )
    if S3_ENDPOINT
    else None
)


def blocking(fn, *a, **kw):
    return asyncio.get_running_loop().run_in_executor(None, lambda: fn(*a, **kw))


# ------------------------------------------------------------------ catálogo
def scan_library() -> list[dict]:
    """La librería debe tener carpetas por plataforma: library/ps2, library/gc, library/wii."""
    root = Path("/library")
    out = []
    for plat in PLATFORMS:
        d = root / plat
        if not d.is_dir():
            continue
        for f in sorted(d.rglob("*")):
            if f.is_file() and f.suffix.lower() in ROM_EXT.get(plat, ()):
                out.append({"platform": plat, "path": f.relative_to(root).as_posix()})
    return out


# ------------------------------------------------------------------- saves
def _save_key(user_id: str, platform: str) -> str:
    return f"{user_id}/{SAVE_GROUP[platform]}.tar.gz"


def download_saves(user_id: str, platform: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    if s3 is not None:
        try:
            resp = s3.get_object(S3_BUCKET, _save_key(user_id, platform))
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


def upload_saves(user_id: str, platform: str, src: Path) -> None:
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
    s3.put_object(S3_BUCKET, _save_key(user_id, platform), buf, size, content_type="application/gzip")
    log.info("partidas subidas para %s/%s (%d KB)", user_id, platform, size // 1024)


# ----------------------------------------------------------------- agente
class Agent:
    def __init__(self):
        self.ws = None
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

    async def reaper(self) -> None:
        while True:
            try:
                await self.reap()
            except Exception:  # noqa: BLE001
                log.exception("reap")
            await asyncio.sleep(3)

    async def handle(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "start":
            asyncio.create_task(self.start(msg))
        elif t == "stop":
            asyncio.create_task(self.stop(msg.get("session_id", "")))

    async def run(self) -> None:
        asyncio.create_task(self.reaper())
        asyncio.create_task(self.heartbeat())
        backoff = 1
        while True:
            try:
                async with websockets.connect(f"{CP_URL}/ws/agent?token={NODE_TOKEN}", ping_interval=20, max_size=2**22) as ws:
                    self.ws, backoff = ws, 1
                    inventory = await blocking(scan_library)
                    await self.send({
                        "type": "hello", "gpu": GPU, "capacity": CAPACITY, "platforms": PLATFORMS,
                        "inventory": inventory, "sessions": list(self.meta),
                    })
                    log.info("conectado al control plane (%d juegos en librería)", len(inventory))
                    async for raw in ws:
                        try:
                            await self.handle(json.loads(raw))
                        except ValueError:
                            pass
            except Exception as e:  # noqa: BLE001
                log.warning("conexión perdida: %s (reintento en %ss)", e, backoff)
            self.ws = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


if __name__ == "__main__":
    asyncio.run(Agent().run())
