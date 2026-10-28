"""Red local entre consolas de la nube ("LOCAL LAN MODE").

Dos jugadores (o hasta 8) ponen el mismo código en su partida y sus consolas quedan conectadas a un mismo
switch Ethernet virtual: los juegos con multijugador por red local (adaptador de red de PS2, Broadband Adapter
de GameCube) se ven entre sí como si estuvieran en la misma LAN.

    consola (Dolphin BBA / PCSX2 DEV9) <-> lanlink.py en la sesión <-- WS /ws/lan/{sid} --> este hub <-> otras sesiones

- Una sala = plataforma + código. Existe solo mientras tiene consolas: con la última que sale, desaparece
  (no queda nada guardado). El código es el secreto: 6 caracteres de 32 (~10^9 combinaciones) y límite de intentos.
- Funciona con varias réplicas de la API: los miembros y las tramas van por Redis (hash lanroom:* y canal lan:*).
- Switch con aprendizaje de MAC: unicast al dueño de la MAC, broadcast/multicast a todos los demás.
- Mensajes: binario = trama Ethernet; texto = control JSON
    sesión -> hub  {"t": "join", "code": "ABCDEF"} · {"t": "leave"}
    hub -> sesión  {"t": "lan", "state": "off"|"waiting"|"on", "code", "slot", "members", "error"?}
"""
import asyncio
import base64
import json
import logging
import time

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from . import bus
from .db import SessionLocal
from .models import ACTIVE_STATES, Game, Session
from .security import new_secret, same_hash, sha256

log = logging.getLogger("cloudplay.lan")
router = APIRouter()

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LEN = 6
MAX_MEMBERS = 8
LAN_PLATFORMS = {"ps2", "gc"}  # consolas con adaptador de red (PS2 Network Adapter, GameCube BBA)
MAX_FRAME = 1518
MIN_FRAME = 14
FRAMES_PER_SEC = 3000  # por consola; los juegos en LAN mandan bastante menos
ROOM_TTL = 3600
MAX_BAD_CODES = 10  # por conexión


def normalize_code(code) -> str | None:
    if not isinstance(code, str):
        return None
    # se aceptan guiones y espacios ("K7Q-2MX"); el alfabeto no tiene O/0 ni I/1 para que no se confundan
    c = "".join(ch for ch in code.upper() if ch.isalnum())
    if len(c) != CODE_LEN or any(ch not in ALPHABET for ch in c):
        return None
    return c


def mac(b: bytes) -> str:
    return b.hex()


class Member:
    def __init__(self, ws: WebSocket, sid: str, platform: str):
        self.ws, self.sid, self.platform = ws, sid, platform
        self.id = new_secret(6)
        self.room: str | None = None
        self.code: str | None = None
        self.slot = 0
        self.tokens = float(FRAMES_PER_SEC)
        self.stamp = time.monotonic()
        self.bad = 0

    def allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(FRAMES_PER_SEC, self.tokens + (now - self.stamp) * FRAMES_PER_SEC)
        self.stamp = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


class Room:
    """Lo que esta réplica sabe de una sala: sus miembros locales y qué MAC tiene cada miembro (de toda la sala)"""

    def __init__(self, key: str):
        self.key = key
        self.local: dict[str, Member] = {}
        self.macs: dict[str, str] = {}  # mac -> id de miembro
        self.task: asyncio.Task | None = None


ROOMS: dict[str, Room] = {}


def _hash(key: str) -> str:
    return f"lanroom:{key}"


def _chan(key: str) -> str:
    return f"lan:{key}"


async def _members(key: str) -> dict[str, dict]:
    raw = await bus.r().hgetall(_hash(key))
    out = {}
    for k, v in raw.items():
        try:
            out[k] = json.loads(v)
        except ValueError:
            continue
    return out


async def _push_state(room: Room) -> None:
    """Estado de la sala a los miembros de esta réplica (la animación del cliente sale de aquí)"""
    members = await _members(room.key)
    n = len(members)
    for m in list(room.local.values()):
        try:
            await m.ws.send_text(json.dumps({"t": "lan", "state": "on" if n >= 2 else "waiting", "code": m.code,
                                             "slot": m.slot, "members": n}))
        except Exception:  # noqa: BLE001 - se limpia al cerrar
            pass


async def _room_listener(room: Room) -> None:
    async with bus.subscribe(_chan(room.key)) as ps:
        async for msg in bus.messages(ps):
            kind = msg.get("k")
            if kind == "m":
                await _push_state(room)
            elif kind == "f":
                try:
                    frame = base64.b64decode(msg["d"])
                except (KeyError, ValueError):
                    continue
                await _deliver(room, msg.get("s", ""), frame)


async def _deliver(room: Room, sender: str, frame: bytes) -> None:
    if len(frame) < MIN_FRAME:
        return
    dst, src = mac(frame[0:6]), mac(frame[6:12])
    if not (frame[6] & 1):  # aprende la MAC de origen (nunca una multicast)
        room.macs[src] = sender
    unicast = not (frame[0] & 1)
    owner = room.macs.get(dst) if unicast else None
    for m in list(room.local.values()):
        if m.id == sender:
            continue
        if owner is not None and owner != m.id:
            continue
        try:
            await m.ws.send_bytes(frame)
        except Exception:  # noqa: BLE001
            pass


async def _join(m: Member, code: str) -> str | None:
    """Mete al miembro en la sala. Devuelve un error legible o None"""
    key = f"{m.platform}:{code}"
    r = bus.r()
    members = await _members(key)
    if len(members) >= MAX_MEMBERS:
        return "La sala está llena (8 consolas)"
    used = {v.get("slot") for v in members.values()}
    slot = next(i for i in range(1, MAX_MEMBERS + 1) if i not in used)
    await r.hset(_hash(key), m.id, json.dumps({"slot": slot, "sid": m.sid}))
    await r.expire(_hash(key), ROOM_TTL)
    # Carrera: si dos entran a la vez con el mismo hueco, el segundo coge otro
    members = await _members(key)
    if sum(1 for v in members.values() if v.get("slot") == slot) > 1 and min(
        k for k, v in members.items() if v.get("slot") == slot
    ) != m.id:
        used = {v.get("slot") for k, v in members.items() if k != m.id}
        free = [i for i in range(1, MAX_MEMBERS + 1) if i not in used]
        if not free:
            await r.hdel(_hash(key), m.id)
            return "La sala está llena (8 consolas)"
        slot = free[0]
        await r.hset(_hash(key), m.id, json.dumps({"slot": slot, "sid": m.sid}))
    m.room, m.code, m.slot = key, code, slot
    room = ROOMS.get(key)
    if room is None:
        room = ROOMS[key] = Room(key)
        room.task = asyncio.create_task(_room_listener(room))
        await asyncio.sleep(0.05)  # que la suscripción esté lista antes de avisar
    room.local[m.id] = m
    await bus.r().publish(_chan(key), json.dumps({"k": "m"}))
    log.info("LAN %s: entra %s (hueco %d)", key, m.sid, slot)
    return None


async def _leave(m: Member) -> None:
    key = m.room
    if key is None:
        return
    m.room, m.code, m.slot = None, None, 0
    await bus.r().hdel(_hash(key), m.id)  # con el último miembro Redis borra la sala entera
    room = ROOMS.get(key)
    if room is not None:
        room.local.pop(m.id, None)
        for k in [k for k, v in room.macs.items() if v == m.id]:
            room.macs.pop(k, None)
    await bus.r().publish(_chan(key), json.dumps({"k": "m"}))
    if room is not None and not room.local:
        # nadie de esta réplica en la sala: se destruye su parte (suscripción incluida)
        ROOMS.pop(key, None)
        if room.task:
            room.task.cancel()
    log.info("LAN %s: sale %s", key, m.sid)


async def _authorize(sid: str, token: str) -> str | None:
    """Solo la sesión (con su token de worker) puede conectar su consola. Devuelve la plataforma."""
    async with SessionLocal() as db:
        s = await db.get(Session, sid)
        if s is None or s.status not in ACTIVE_STATES or not same_hash(s.worker_token_hash, sha256(token)):
            return None
        return await db.scalar(select(Game.platform).where(Game.id == s.game_id))


@router.websocket("/ws/lan/{sid}")
async def lan_ws(ws: WebSocket, sid: str, token: str = Query(...)):
    platform = await _authorize(sid, token)
    if platform is None:
        await ws.close(code=4403)
        return
    await ws.accept()
    m = Member(ws, sid, platform)
    if platform not in LAN_PLATFORMS:
        await ws.send_text(json.dumps({"t": "lan", "state": "off", "error": "Esta consola no tiene red local"}))
        await ws.close()
        return
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data, text = msg.get("bytes"), msg.get("text")
            if data is not None:
                if m.room and MIN_FRAME <= len(data) <= MAX_FRAME and m.allow():
                    room = ROOMS.get(m.room)
                    if room is not None:
                        if not (data[6] & 1):
                            room.macs[mac(data[6:12])] = m.id
                    await bus.r().publish(_chan(m.room), json.dumps({"k": "f", "s": m.id, "d": base64.b64encode(data).decode()}))
                continue
            try:
                c = json.loads(text or "")
            except ValueError:
                continue
            if not isinstance(c, dict):
                continue
            if c.get("t") == "join":
                code = normalize_code(c.get("code"))
                if code is None:
                    m.bad += 1
                    await ws.send_text(json.dumps({"t": "lan", "state": "off", "error": "Código no válido"}))
                    if m.bad >= MAX_BAD_CODES:
                        break
                    continue
                if m.room:
                    await _leave(m)
                err = await _join(m, code)
                if err:
                    await ws.send_text(json.dumps({"t": "lan", "state": "off", "error": err}))
            elif c.get("t") == "leave":
                await _leave(m)
                await ws.send_text(json.dumps({"t": "lan", "state": "off"}))
    except WebSocketDisconnect:
        pass
    finally:
        await _leave(m)
