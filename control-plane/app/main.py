import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from . import bus
from .config import settings
from .db import SessionLocal, engine, is_postgres
from .models import Base, User
from .reaper import reaper_loop
from .routes import admin, auth, catalog, sessions
from .security import hash_password
from .ws import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def init_db() -> None:
    async with engine.begin() as conn:
        if is_postgres():  # varias réplicas arrancando a la vez
            await conn.execute(text("SELECT pg_advisory_xact_lock(4242)"))
        await conn.run_sync(Base.metadata.create_all)
    if settings.admin_email and settings.admin_password:
        async with SessionLocal() as db:
            email = settings.admin_email.lower()
            if not await db.scalar(select(User).where(User.email == email)):
                db.add(User(email=email, password_hash=hash_password(settings.admin_password), is_admin=True, max_sessions=4))
                await db.commit()
                logging.info("admin creado: %s", email)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    task = asyncio.create_task(reaper_loop())
    yield
    task.cancel()
    await bus.close()


app = FastAPI(title="CloudPlay control plane", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (auth.router, catalog.router, sessions.router, admin.router, ws_router):
    app.include_router(r)


@app.get("/api/health")
async def health():
    return {"ok": True}
