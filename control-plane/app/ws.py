"""WebSockets: canal de control de los agentes y señalización WebRTC cliente<->worker."""
import asyncio
import json
import logging
import re
from pathlib import PurePosixPath

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from . import bus
from .db import SessionLocal
from .models import ACTIVE_STATES, PLATFORMS, Game, Node, Session, now
from .security import decode_jwt, new_secret, same_hash, sha256

log = logging.getLogger("cloudplay.ws")
router = APIRouter()

MAX_SIGNAL_MSG = 64 * 1024
SIGNAL_TYPES = {"offer", "answer", "ice", "bye"}


async def _first_done(*coros) -> None:
    """Ejecuta corrutinas en paralelo; cuando una termina cancela las demás."""
    tasks = [asyncio.create_task(c) for c in coros]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            exc = t.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                log.warning("ws task error: %r", exc)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


# ---------------------------------------------------------------- agentes ---

_TAG = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")


def clean_title(path: str) -> str:
    stem = PurePosixPath(path).stem
    t = _TAG.sub("", stem).replace("_", " ").strip()
    return t or stem


async def _upsert_inventory(db, inventory: list[dict]) -> int:
    existing = {(g.platform, g.rom_path) for g in (await db.scalars(select(Game))).all()}
    added = 0
    for item in inventory[:20000]:
        p, path = item.get("platform"), item.get("path")
        if p not in PLATFORMS or not path or (p, path) in existing:
            continue
        db.add(Game(platform=p, rom_path=path, title=(item.get("title") or clean_title(path))[:255]))
        existing.add((p, path))
        added += 1
    return added


async def handle_agent_msg(node_id: str, msg: dict) -> None:
    kind = msg.get("type")
    async with SessionLocal() as db:
        node = await db.get(Node, node_id)
        if node is None:
            return
        node.last_seen = now()
        node.status = "online"

        if kind == "hello":
            node.gpu = str(msg.get("gpu", "unknown"))[:64]
            if isinstance(msg.get("capacity"), int) and msg["capacity"] > 0:
                node.capacity = msg["capacity"]
            plats = [p for p in msg.get("platforms", []) if p in PLATFORMS]
            if plats:
                node.platforms = "," + ",".join(plats) + ","
            added = await _upsert_inventory(db, msg.get("inventory", []))
            if added:
                log.info("nodo %s: %d juegos nuevos en el catálogo", node.name, added)
            # Reconciliar: lo que la BD cree activo en este nodo pero el agente no conoce, ha muerto.
            running = set(msg.get("sessions", []))
            stale = (
                await db.scalars(
                    select(Session).where(Session.node_id == node_id, Session.status.in_(ACTIVE_STATES))
                )
            ).all()
            for s in stale:
                if s.id not in running:
                    s.status, s.error, s.ended_at = "failed", "El nodo se reinició", now()

        elif kind == "drain":
            node.draining = bool(msg.get("on", True))
            log.info("nodo %s %s", node.name, "drenando" if node.draining else "vuelve a aceptar partidas")

        elif kind == "session_state":
            s = await db.get(Session, msg.get("session_id", ""))
            if s is not None and s.node_id == node_id and s.status in ACTIVE_STATES:
                st = msg.get("status")
                if st == "running":
                    s.status, s.started_at = "running", now()
                elif st in ("ended", "failed"):
                    s.status, s.ended_at = st, now()
                    s.error = (msg.get("error") or None) and str(msg["error"])[:2000]
                await db.commit()
                await bus.publish(
                    f"sig:{s.id}:client", {"type": "session-state", "status": s.status, "error": s.error}
                )
                return
        await db.commit()


@router.websocket("/ws/agent")
async def agent_ws(ws: WebSocket, token: str = Query(...)):
    node_id, _, secret = token.partition(".")
    async with SessionLocal() as db:
        node = await db.get(Node, node_id) if node_id else None
        ok = node is not None and secret and same_hash(node.token_hash, sha256(secret))
        name = node.name if node else "?"
    if not ok:
        await ws.close(code=4401)
        return
    await ws.accept()
    log.info("agente conectado: %s", name)

    async with bus.subscribe(f"node:{node_id}") as ps:

        async def down():
            async for m in bus.messages(ps):
                await ws.send_json(m)

        async def up():
            while True:
                raw = await ws.receive_text()
                try:
                    await handle_agent_msg(node_id, json.loads(raw))
                except (ValueError, TypeError):
                    continue

        await _first_done(down(), up())

    log.info("agente desconectado: %s", name)
    # No marcamos sesiones como fallidas aquí: el agente puede reconectar en segundos.
    # El reaper se encarga si no vuelve antes del heartbeat timeout.


# ------------------------------------------------------------ señalización ---

async def _authorize_signal(sid: str, role: str, token: str) -> bool:
    async with SessionLocal() as db:
        s = await db.get(Session, sid)
        if s is None or s.status not in ACTIVE_STATES:
            return False
        if role == "worker":
            return same_hash(s.worker_token_hash, sha256(token))
        p = decode_jwt(token)
        return bool(p and p["sub"] == s.user_id)


@router.websocket("/ws/signal/{sid}")
async def signal_ws(ws: WebSocket, sid: str, role: str = Query(...), token: str = Query(...)):
    if role not in ("client", "worker") or not await _authorize_signal(sid, role, token):
        await ws.close(code=4403)
        return
    await ws.accept()

    other = "worker" if role == "client" else "client"
    me_ch, other_ch = f"sig:{sid}:{role}", f"sig:{sid}:{other}"
    presence = f"sig:{sid}:present:{role}"
    conn = new_secret(8)
    r = bus.r()

    async with bus.subscribe(me_ch) as ps:
        # Si había otra conexión con el mismo rol (p.ej. el móvil reconecta), la echamos.
        await bus.publish(me_ch, {"type": "kick", "conn": conn})
        await r.set(presence, conn, ex=60)
        await bus.publish(other_ch, {"type": "peer-joined", "role": role})
        if await r.exists(f"sig:{sid}:present:{other}"):
            await ws.send_json({"type": "peer-joined", "role": other})

        async def down():
            async for m in bus.messages(ps):
                if m.get("type") == "kick":
                    if m.get("conn") != conn:
                        await ws.close(code=4409)
                        return
                    continue
                await ws.send_json(m)

        async def up():
            while True:
                raw = await ws.receive_text()
                if len(raw) > MAX_SIGNAL_MSG:
                    continue
                try:
                    m = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(m, dict) and m.get("type") in SIGNAL_TYPES:
                    m["from"] = role
                    await bus.publish(other_ch, m)

        async def keepalive():
            while True:
                await asyncio.sleep(20)
                await r.set(presence, conn, ex=60)

        try:
            await _first_done(down(), up(), keepalive())
        finally:
            if await r.get(presence) == conn:
                await r.delete(presence)
                await bus.publish(other_ch, {"type": "peer-left", "role": role})
