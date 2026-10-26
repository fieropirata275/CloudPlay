"""Alta automática de nodos gaming con el token de unión (CP_JOIN_TOKEN).

Así una plantilla de Proxmox, una ISO o un DaemonSet de Kubernetes se unen solos al arrancar:
el agente llama aquí una vez, guarda su token propio y a partir de ahí entra por /ws/agent.
"""
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import bus
from ..config import settings
from ..db import AsyncSession, get_db
from ..models import PLATFORMS, Node
from ..security import new_secret, sha256
from .admin import create_node, platforms_field

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


def _node_config() -> dict:
    s3 = None
    if settings.node_s3_endpoint:
        s3 = {
            "endpoint": settings.node_s3_endpoint,
            "access_key": settings.node_s3_access_key,
            "secret_key": settings.node_s3_secret_key,
            "bucket": settings.node_s3_bucket,
        }
    return {"s3": s3}


class EnrollIn(BaseModel):
    join_token: str = Field(min_length=16, max_length=256)
    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    capacity: int = Field(default=2, ge=1, le=64)
    platforms: list[str] = Field(default_factory=lambda: list(PLATFORMS))


@router.post("/enroll", status_code=201)
async def enroll(body: EnrollIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not settings.join_token:
        raise HTTPException(404, "El alta automática de nodos está desactivada (define CP_JOIN_TOKEN)")
    # Freno a la fuerza bruta: 20 intentos por IP y hora
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    key = f"enroll:{sha256(ip)[:16]}"
    r = bus.r()
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 3600)
    if n > 20:
        raise HTTPException(429, "Demasiados intentos; espera una hora")
    if not hmac.compare_digest(body.join_token, settings.join_token):
        raise HTTPException(401, "Token de unión incorrecto")

    node = await db.scalar(select(Node).where(Node.name == body.name))
    if node is not None:
        # La misma máquina reinstalada (o una plantilla que reusa nombre): nuevo token, mismo nodo
        secret = new_secret()
        node.token_hash = sha256(secret)
        node.capacity = body.capacity
        node.platforms = platforms_field(body.platforms)
        await db.commit()
        return {"id": node.id, "name": node.name, "token": f"{node.id}.{secret}", "rejoined": True, **_node_config()}
    node, token = await create_node(db, body.name, body.capacity, body.platforms)
    return {"id": node.id, "name": node.name, "token": token, "rejoined": False, **_node_config()}
