from fastapi import APIRouter, Depends
from sqlalchemy import select

from ..db import AsyncSession, get_db
from ..models import PLATFORMS, Game, User
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
async def list_games(platform: str | None = None, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    q = select(Game).where(Game.enabled.is_(True)).order_by(Game.title)
    if platform:
        q = q.where(Game.platform == platform)
    return [game_dict(g) for g in (await db.scalars(q)).all()]
