from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from .. import bus
from ..config import settings
from ..db import AsyncSession, get_db
from ..models import ACTIVE_STATES, Game, Session, User, now
from ..scheduler import pick_node
from ..security import current_user, ice_servers, new_secret, sha256
from .catalog import game_dict

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class CreateSession(BaseModel):
    game_id: str


def session_dict(s: Session, user: User, game: Game | None = None) -> dict:
    d = {
        "id": s.id,
        "status": s.status,
        "error": s.error,
        "game_id": s.game_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if game is not None:
        d["game"] = game_dict(game)
    if s.status in ACTIVE_STATES:
        d["signal_url"] = f"{settings.ws_base}/ws/signal/{s.id}"
        d["ice_servers"] = ice_servers(f"user-{user.id}")
    return d


async def _owned(db: AsyncSession, sid: str, user: User) -> Session:
    s = await db.get(Session, sid)
    if s is None or s.user_id != user.id:
        raise HTTPException(404, "Sesión no encontrada")
    return s


@router.post("", status_code=201)
async def create_session(body: CreateSession, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    game = await db.get(Game, body.game_id)
    if game is None or not game.enabled:
        raise HTTPException(404, "Juego no encontrado")

    active = await db.scalar(
        select(func.count()).select_from(Session).where(Session.user_id == user.id, Session.status.in_(ACTIVE_STATES))
    )
    if active >= user.max_sessions:
        raise HTTPException(409, "Ya tienes una sesión activa")

    node = await pick_node(db, game.platform)
    if node is None:
        await db.rollback()
        raise HTTPException(503, "No hay nodos libres ahora mismo, prueba en un rato")

    worker_token = new_secret()
    s = Session(
        user_id=user.id, game_id=game.id, node_id=node.id, status="starting", worker_token_hash=sha256(worker_token)
    )
    db.add(s)
    await db.commit()

    await bus.publish(
        f"node:{node.id}",
        {
            "type": "start",
            "session_id": s.id,
            "worker_token": worker_token,
            "signal_url": f"{settings.ws_base}/ws/signal/{s.id}",
            "ice_servers": ice_servers(f"node-{node.id}"),
            "platform": game.platform,
            "rom_path": game.rom_path,
            "title": game.title,
            "user_id": user.id,
        },
    )
    return session_dict(s, user, game)


@router.get("")
async def list_active(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(Session, Game)
        .join(Game, Game.id == Session.game_id)
        .where(Session.user_id == user.id, Session.status.in_(ACTIVE_STATES))
        .order_by(Session.created_at.desc())
    )
    return [session_dict(s, user, g) for s, g in rows.all()]


@router.get("/{sid}")
async def get_session(sid: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _owned(db, sid, user)
    return session_dict(s, user, await db.get(Game, s.game_id))


@router.delete("/{sid}")
async def end_session(sid: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _owned(db, sid, user)
    if s.status not in ACTIVE_STATES:
        return {"ok": True, "status": s.status}
    if s.node_id is None:
        s.status, s.ended_at = "ended", now()
    else:
        s.status = "ending"
    await db.commit()
    if s.node_id:
        await bus.publish(f"node:{s.node_id}", {"type": "stop", "session_id": s.id})
    return {"ok": True, "status": s.status}
