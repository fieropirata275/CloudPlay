from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..db import AsyncSession, get_db
from ..models import ACTIVE_STATES, PLATFORMS, Game, Node, Session, User
from ..security import admin_user, hash_password, new_secret, sha256
from .catalog import game_dict

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
            await db.scalars(select(Session.id).where(Session.node_id == n.id, Session.status.in_(ACTIVE_STATES)))
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


@router.get("/sessions")
async def active_sessions(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Session).where(Session.status.in_(ACTIVE_STATES)))).all()
    return [
        {"id": s.id, "user_id": s.user_id, "game_id": s.game_id, "node_id": s.node_id, "status": s.status}
        for s in rows
    ]
