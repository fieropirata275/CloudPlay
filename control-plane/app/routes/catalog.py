from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from ..db import AsyncSession, get_db
from ..models import PLATFORMS, Favorite, Game, Session, User
from ..security import current_user

router = APIRouter(prefix="/api", tags=["catalog"])


def game_dict(g: Game) -> dict:
    return {
        "id": g.id,
        "title": g.title,
        "platform": g.platform,
        "platform_name": PLATFORMS.get(g.platform, g.platform),
        "cover_url": g.cover_url,
    }


@router.get("/platforms")
async def platforms():
    return [{"id": k, "name": v} for k, v in PLATFORMS.items()]


@router.get("/games")
async def list_games(platform: str | None = None, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Catálogo con datos personales: favorito, última partida y nº de partidas."""
    q = select(Game).where(Game.enabled.is_(True)).order_by(Game.title)
    if platform:
        q = q.where(Game.platform == platform)
    favs = set((await db.scalars(select(Favorite.game_id).where(Favorite.user_id == user.id))).all())
    stats = {
        gid: (last, n)
        for gid, last, n in (
            await db.execute(
                select(Session.game_id, func.max(Session.created_at), func.count())
                .where(Session.user_id == user.id, Session.status.in_(("running", "ending", "ended")))
                .group_by(Session.game_id)
            )
        ).all()
    }
    out = []
    for g in (await db.scalars(q)).all():
        last, n = stats.get(g.id, (None, 0))
        out.append({**game_dict(g), "favorite": g.id in favs, "last_played": last.isoformat() if last else None, "play_count": n})
    return out


@router.put("/favorites/{game_id}")
async def add_favorite(game_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if await db.get(Game, game_id) is None:
        raise HTTPException(404, "Juego no encontrado")
    if await db.get(Favorite, (user.id, game_id)) is None:
        db.add(Favorite(user_id=user.id, game_id=game_id))
        await db.commit()
    return {"favorite": True}


@router.delete("/favorites/{game_id}")
async def remove_favorite(game_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    fav = await db.get(Favorite, (user.id, game_id))
    if fav is not None:
        await db.delete(fav)
        await db.commit()
    return {"favorite": False}
