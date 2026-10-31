"""Tarea de mantenimiento: nodos caídos y sesiones atascadas. Solo una réplica a la vez (lock en Redis)."""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from . import bus, mail
from .config import settings
from .db import SessionLocal
from .models import ACTIVE_STATES, Node, Session, now

log = logging.getLogger("cloudplay.reaper")


async def reap_once() -> None:
    t = now()
    stops: list[tuple[str, str]] = []
    async with SessionLocal() as db:
        cutoff = t - timedelta(seconds=settings.node_heartbeat_timeout)
        dead = (await db.scalars(select(Node).where(Node.status == "online", Node.last_seen < cutoff))).all()
        dead_ids = {n.id for n in dead}
        for n in dead:
            n.status = "offline"
            log.warning("nodo %s sin heartbeat -> offline", n.name)

        down = [(n.id, n.name) for n in dead]
        failed = {n.id: 0 for n in dead}
        active = (await db.scalars(select(Session).where(Session.status.in_(ACTIVE_STATES)))).all()
        start_cutoff = t - timedelta(seconds=settings.session_start_timeout)
        for s in active:
            if s.node_id in dead_ids:
                failed[s.node_id] += 1
                s.status, s.error, s.ended_at = "failed", "Nodo caído", t
            elif s.status in ("starting", "pending", "ending") and _aware(s.dispatched_at or s.created_at) < start_cutoff:
                if s.status != "ending":
                    s.error = "Timeout arrancando la sesión"
                s.status = "failed" if s.status != "ending" else "ended"
                s.ended_at = t
                if s.node_id:
                    stops.append((s.node_id, s.id))
        await db.commit()
    for node_id, sid in stops:
        await bus.publish(f"node:{node_id}", {"type": "stop", "session_id": sid})
    # Aviso al NOC por correo (como mucho uno por nodo y hora, aunque parpadee)
    for node_id, name in down:
        if await bus.r().set(f"mail:nodedown:{node_id}", "1", nx=True, ex=3600):
            await mail.queue_admins("node_down", {"name": name, "failed": failed[node_id]})


def _aware(dt):
    # SQLite (tests) devuelve datetimes naive
    from datetime import timezone

    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def reaper_loop(interval: float = 15) -> None:
    while True:
        try:
            if await bus.r().set("lock:reaper", "1", nx=True, ex=int(interval) + 5):
                await reap_once()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("reaper")
        await asyncio.sleep(interval)
