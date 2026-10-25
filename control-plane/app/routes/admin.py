from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..db import AsyncSession, get_db
from ..dispatch import queue_positions
from ..models import ACTIVE_STATES, PLACED_STATES, PLATFORMS, Game, Lead, Node, Session, User, now
from ..security import admin_user, hash_password, new_secret, sha256
from .catalog import game_dict
from .sessions import stop_session

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_user)])


class NodeIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    capacity: int = Field(default=2, ge=1, le=64)
    platforms: list[str] = ["ps2", "gc", "wii"]


class GameIn(BaseModel):
    title: str
    platform: str
    rom_path: str
    cover_url: str | None = None
    enabled: bool = True


class GamePatch(BaseModel):
    title: str | None = None
    cover_url: str | None = None
    enabled: bool | None = None


class UserIn(BaseModel):
    email: str
    password: str = Field(min_length=8)
    is_admin: bool = False
    max_sessions: int = 1


def platforms_field(ps: list[str]) -> str:
    bad = [p for p in ps if p not in PLATFORMS]
    if bad:
        raise HTTPException(422, f"Plataformas desconocidas: {bad}")
    return "," + ",".join(ps) + ","


async def create_node(db: AsyncSession, name: str, capacity: int, platforms: list[str]) -> tuple[Node, str]:
    secret = new_secret()
    node = Node(name=name, capacity=capacity, platforms=platforms_field(platforms), token_hash=sha256(secret))
    db.add(node)
    await db.commit()
    return node, f"{node.id}.{secret}"


@router.post("/nodes", status_code=201)
async def add_node(body: NodeIn, db: AsyncSession = Depends(get_db)):
    if await db.scalar(select(Node).where(Node.name == body.name)):
        raise HTTPException(409, "Ya existe un nodo con ese nombre")
    node, token = await create_node(db, body.name, body.capacity, body.platforms)
    return {"id": node.id, "name": node.name, "token": token, "note": "Guarda el token: no se vuelve a mostrar"}


@router.get("/nodes")
async def list_nodes(db: AsyncSession = Depends(get_db)):
    nodes = (await db.scalars(select(Node).order_by(Node.name))).all()
    out = []
    for n in nodes:
        active = (
            await db.scalars(select(Session.id).where(Session.node_id == n.id, Session.status.in_(PLACED_STATES)))
        ).all()
        out.append(
            {
                "id": n.id,
                "name": n.name,
                "status": n.status,
                "gpu": n.gpu,
                "capacity": n.capacity,
                "load": len(active),
                "platforms": n.platforms.strip(",").split(","),
                "last_seen": n.last_seen.isoformat() if n.last_seen else None,
            }
        )
    return out


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db)):
    node = await db.get(Node, node_id)
    if node is None:
        raise HTTPException(404)
    await db.delete(node)
    await db.commit()
    return {"ok": True}


@router.get("/games")
async def all_games(db: AsyncSession = Depends(get_db)):
    games = (await db.scalars(select(Game).order_by(Game.platform, Game.title))).all()
    return [{**game_dict(g), "rom_path": g.rom_path, "enabled": g.enabled} for g in games]


@router.post("/games", status_code=201)
async def add_game(body: GameIn, db: AsyncSession = Depends(get_db)):
    if body.platform not in PLATFORMS:
        raise HTTPException(422, "Plataforma desconocida")
    g = Game(**body.model_dump())
    db.add(g)
    await db.commit()
    return game_dict(g)


@router.patch("/games/{game_id}")
async def patch_game(game_id: str, body: GamePatch, db: AsyncSession = Depends(get_db)):
    g = await db.get(Game, game_id)
    if g is None:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(g, k, v)
    await db.commit()
    return game_dict(g)


@router.post("/users", status_code=201)
async def add_user(body: UserIn, db: AsyncSession = Depends(get_db)):
    email = body.email.lower().strip()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Ese email ya existe")
    u = User(email=email, password_hash=hash_password(body.password), is_admin=body.is_admin, max_sessions=body.max_sessions)
    db.add(u)
    await db.commit()
    return {"id": u.id, "email": u.email}


@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db)):
    users = (await db.scalars(select(User).order_by(User.email))).all()
    return [{"id": u.id, "email": u.email, "is_admin": u.is_admin, "max_sessions": u.max_sessions} for u in users]


@router.get("/sessions")
async def active_sessions(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(Session, User.email, Game.title, Game.platform, Node.name)
        .join(User, User.id == Session.user_id)
        .join(Game, Game.id == Session.game_id)
        .outerjoin(Node, Node.id == Session.node_id)
        .where(Session.status.in_(ACTIVE_STATES))
        .order_by(Session.created_at)
    )
    positions = await queue_positions(db)
    return [
        {
            "id": s.id, "status": s.status, "user": email, "game": title, "platform": platform, "node": node_name,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "queue_position": positions.get(s.id),
        }
        for s, email, title, platform, node_name in rows.all()
    ]


@router.delete("/sessions/{sid}")
async def kill_session(sid: str, db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, sid)
    if s is None:
        raise HTTPException(404)
    return await stop_session(db, s)


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    nodes = (await db.scalars(select(Node))).all()
    online = [n for n in nodes if n.status == "online"]
    by_status = dict(
        (await db.execute(select(Session.status, func.count()).where(Session.status.in_(ACTIVE_STATES)).group_by(Session.status))).all()
    )
    since = now() - timedelta(hours=24)
    day = dict(
        (await db.execute(select(Session.status, func.count()).where(Session.created_at >= since).group_by(Session.status))).all()
    )
    return {
        "nodes_total": len(nodes),
        "nodes_online": len(online),
        "capacity_online": sum(n.capacity for n in online),
        "placed": sum(by_status.get(k, 0) for k in PLACED_STATES),
        "queued": by_status.get("queued", 0),
        "sessions_24h": sum(day.values()),
        "failed_24h": day.get("failed", 0),
        "games": await db.scalar(select(func.count()).select_from(Game)),
    }


@router.get("/leads")
async def list_leads(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Lead).order_by(Lead.created_at.desc()).limit(200))).all()
    return [
        {"id": l.id, "name": l.name, "email": l.email, "company": l.company, "players": l.players,
         "message": l.message, "created_at": l.created_at.isoformat() if l.created_at else None}
        for l in rows
    ]
