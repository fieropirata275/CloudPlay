"""Cola de espera FIFO y colocación de sesiones en nodos.

Si no hay hueco, la sesión queda en estado `queued`. Un bucle (una réplica a la vez,
lock en Redis) intenta colocarlas cada 2 s en orden de llegada y avisa a los clientes
de su posición por el canal de señalización (`{"type": "queue", "position": n}`).
"""
import asyncio
import logging
from datetime import timedelta, timezone

from sqlalchemy import select

from . import bus
from .config import settings
from .db import AsyncSession, SessionLocal
from .models import Game, Node, Session, now
from .scheduler import pick_node
from .security import ice_servers, new_secret, sha256

log = logging.getLogger("cloudplay.dispatch")


def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def try_place(db: AsyncSession, s: Session, game: Game) -> dict | None:
    """Intenta asignar nodo. Devuelve el comando `start` a publicar TRAS el commit, o None."""
    node: Node | None = await pick_node(db, game.platform)
    if node is None:
        return None
    worker_token = new_secret()  # se genera al colocar: en la BD solo queda el hash
    s.node_id, s.status, s.dispatched_at = node.id, "starting", now()
    s.worker_token_hash = sha256(worker_token)
    await db.flush()  # el siguiente pick_node ya cuenta esta sesión
    return {
        "type": "start",
        "session_id": s.id,
        "worker_token": worker_token,
        "signal_url": f"{settings.ws_base}/ws/signal/{s.id}",
        "ice_servers": ice_servers(f"node-{node.id}"),
        "platform": game.platform,
        "rom_path": game.rom_path,
        "title": game.title,
        "user_id": s.user_id,
        "_node": node.id,
    }


async def publish_start(cmd: dict) -> None:
    node_id = cmd.pop("_node")
    await bus.publish(f"node:{node_id}", cmd)
    await bus.publish(f"sig:{cmd['session_id']}:client", {"type": "session-state", "status": "starting", "error": None})


async def queue_positions(db: AsyncSession) -> dict[str, int]:
    """Posición (1..n) de cada sesión en cola, contada dentro de su plataforma."""
    rows = await db.execute(
        select(Session.id, Game.platform)
        .join(Game, Game.id == Session.game_id)
        .where(Session.status == "queued")
        .order_by(Session.created_at)
    )
    counters: dict[str, int] = {}
    out: dict[str, int] = {}
    for sid, platform in rows.all():
        counters[platform] = counters.get(platform, 0) + 1
        out[sid] = counters[platform]
    return out


async def dispatch_once() -> int:
    starts: list[dict] = []
    failed: list[str] = []
    async with SessionLocal() as db:
        rows = await db.execute(
            select(Session, Game).join(Game, Game.id == Session.game_id)
            .where(Session.status == "queued").order_by(Session.created_at)
        )
        deadline = now() - timedelta(seconds=settings.queue_max_wait)
        blocked: set[str] = set()  # plataformas sin hueco en esta pasada: respeta el orden FIFO
        for s, game in rows.all():
            if _aware(s.created_at) < deadline:
                s.status, s.error, s.ended_at = "failed", "Tiempo de espera en cola agotado", now()
                failed.append(s.id)
                continue
            if game.platform in blocked:
                continue
            cmd = await try_place(db, s, game)
            if cmd:
                starts.append(cmd)
            else:
                blocked.add(game.platform)
        await db.commit()
        positions = await queue_positions(db)

    for cmd in starts:
        log.info("sesión %s sale de la cola", cmd["session_id"])
        await publish_start(cmd)
    for sid in failed:
        await bus.publish(f"sig:{sid}:client", {"type": "session-state", "status": "failed", "error": "Tiempo de espera en cola agotado"})
    for sid, pos in positions.items():
        await bus.publish(f"sig:{sid}:client", {"type": "queue", "position": pos})
    return len(starts)


async def dispatcher_loop(interval: float = 2) -> None:
    while True:
        try:
            if await bus.r().set("lock:dispatch", "1", nx=True, ex=max(1, int(interval))):
                await dispatch_once()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("dispatcher")
        await asyncio.sleep(interval)
