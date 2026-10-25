from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


def is_postgres() -> bool:
    return engine.dialect.name == "postgresql"


async def get_db():
    async with SessionLocal() as db:
        yield db


__all__ = ["engine", "SessionLocal", "get_db", "AsyncSession", "is_postgres"]
