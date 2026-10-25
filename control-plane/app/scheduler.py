"""Colocación de sesiones en nodos: el nodo online con menos carga que soporte la plataforma."""
from datetime import timedelta

from sqlalchemy import func, select, text

from .config import settings
from .db import AsyncSession, is_postgres
from .models import ACTIVE_STATES, Node, Session, now


async def pick_node(db: AsyncSession, platform: str) -> Node | None:
    # Serializa la planificación entre réplicas de la API: evita que dos peticiones
    # simultáneas metan una sesión de más en el mismo nodo. Se libera al hacer commit.
    if is_postgres():
        await db.execute(text("SELECT pg_advisory_xact_lock(424242)"))

    load = (
        select(Session.node_id, func.count().label("n"))
        .where(Session.status.in_(ACTIVE_STATES), Session.node_id.is_not(None))
        .group_by(Session.node_id)
        .subquery()
    )
    cutoff = now() - timedelta(seconds=settings.node_heartbeat_timeout)
    q = (
        select(Node, func.coalesce(load.c.n, 0).label("load"))
        .outerjoin(load, load.c.node_id == Node.id)
        .where(Node.status == "online", Node.last_seen >= cutoff, Node.platforms.like(f"%,{platform},%"))
        .order_by(func.coalesce(load.c.n, 0) * 1.0 / Node.capacity, Node.name)
    )
    for node, n in (await db.execute(q)).all():
        if n < node.capacity:
            return node
    return None
