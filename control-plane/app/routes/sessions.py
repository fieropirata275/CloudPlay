from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import bus
from ..config import settings
from ..db import AsyncSession, get_db
from ..dispatch import publish_start, queue_positions, try_place
from ..models import ACTIVE_STATES, Game, Node, Session, User, now
from ..security import current_user, ice_servers, new_secret, sha256
from .catalog import game_dict

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# Accesorios que la consola de la nube puede emular con lo que el jugador tiene en su ordenador
Accessory = Literal[
    "singstar", "headset", "eyetoy", "buzz", "guitar", "drums", "guncon2", "usb_keyboard", "usb_mouse",  # PS2
    "gc_bongos", "gc_mic", "gc_keyboard",  # GameCube
    "wii_speak", "wii_keyboard",  # Wii (Wiimote, Nunchuk, Classic, Balance Board... van por wii_real)
]


class SessionOptions(BaseModel):
    wii_real: bool = False  # Wiimotes / Balance Board reales del jugador (puente HID)
    mic: bool = False  # el micro del ordenador del jugador viaja a la nube
    camera: bool = False  # su cámara (EyeToy)
    accessories: list[Accessory] = Field(default_factory=list, max_length=4)


class CreateSession(BaseModel):
    game_id: str
    options: SessionOptions = Field(default_factory=SessionOptions)


def session_dict(s: Session, user: User, game: Game | None = None, position: int | None = None) -> dict:
    d = {
        "id": s.id,
        "status": s.status,
        "error": s.error,
        "game_id": s.game_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if game is not None:
        d["game"] = game_dict(game)
    if position is not None:
        d["queue_position"] = position
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

    # ¿Existe algún nodo (aunque esté lleno u offline) que sirva esta plataforma?
    if not await db.scalar(select(Node.id).where(Node.platforms.like(f"%,{game.platform},%")).limit(1)):
        raise HTTPException(503, "Ningún nodo sirve esta plataforma todavía")

    s = Session(user_id=user.id, game_id=game.id, status="queued", worker_token_hash=sha256(new_secret()),
                options=body.options.model_dump_json())
    db.add(s)
    await db.flush()

    # Solo nos colamos si no hay nadie esperando esta plataforma (FIFO justo)
    waiting = await db.scalar(
        select(func.count()).select_from(Session).join(Game, Game.id == Session.game_id)
        .where(Session.status == "queued", Game.platform == game.platform, Session.id != s.id)
    )
    cmd = await try_place(db, s, game) if not waiting else None
    if cmd is None:
        total_queued = await db.scalar(select(func.count()).select_from(Session).where(Session.status == "queued"))
        if total_queued > settings.queue_max_length:
            await db.rollback()
            raise HTTPException(503, "La cola está llena, prueba en un rato")
    await db.commit()

    if cmd:
        await publish_start(cmd)
        return session_dict(s, user, game)
    pos = (await queue_positions(db)).get(s.id)
    return JSONResponse(session_dict(s, user, game, pos), status_code=202)


@router.get("")
async def list_active(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(Session, Game)
        .join(Game, Game.id == Session.game_id)
        .where(Session.user_id == user.id, Session.status.in_(ACTIVE_STATES))
        .order_by(Session.created_at.desc())
    )
    positions = await queue_positions(db)
    return [session_dict(s, user, g, positions.get(s.id)) for s, g in rows.all()]


@router.get("/{sid}")
async def get_session(sid: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _owned(db, sid, user)
    pos = (await queue_positions(db)).get(s.id) if s.status == "queued" else None
    return session_dict(s, user, await db.get(Game, s.game_id), pos)


@router.delete("/{sid}")
async def end_session(sid: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _owned(db, sid, user)
    return await stop_session(db, s)


async def stop_session(db: AsyncSession, s: Session) -> dict:
    if s.status not in ACTIVE_STATES:
        return {"ok": True, "status": s.status}
    if s.node_id is None:  # en cola o sin colocar
        s.status, s.ended_at = "ended", now()
    else:
        s.status = "ending"
    await db.commit()
    if s.node_id:
        await bus.publish(f"node:{s.node_id}", {"type": "stop", "session_id": s.id})
    else:
        await bus.publish(f"sig:{s.id}:client", {"type": "session-state", "status": "ended", "error": None})
    return {"ok": True, "status": s.status}
