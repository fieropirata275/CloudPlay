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
from .dispatch import dispatcher_loop
from .reaper import reaper_loop
from .routes import admin, auth, catalog, leads, nodes, sessions
from .turn import turn_loop
from .security import hash_password
from .ws import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# Columnas nuevas en tablas que ya existían (create_all no altera tablas). Idempotente.
_NEW_COLUMNS = [("nodes", "draining", "BOOLEAN NOT NULL DEFAULT FALSE"), ("sessions", "options", "TEXT")]


async def _migrate(conn) -> None:
    for table, col, ddl in _NEW_COLUMNS:
        if is_postgres():
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ddl}"))
        else:
            cols = {r[1] for r in (await conn.execute(text(f"PRAGMA table_info({table})"))).all()}
            if col not in cols:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


async def init_db() -> None:
    async with engine.begin() as conn:
        if is_postgres():  # varias réplicas arrancando a la vez
            await conn.execute(text("SELECT pg_advisory_xact_lock(4242)"))
        await conn.run_sync(Base.metadata.create_all)
        await _migrate(conn)
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
    tasks = [asyncio.create_task(reaper_loop()), asyncio.create_task(dispatcher_loop()), asyncio.create_task(turn_loop())]
    yield
    for t in tasks:
        t.cancel()
    await bus.close()


app = FastAPI(title="CloudPlay control plane", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (auth.router, catalog.router, sessions.router, admin.router, leads.router, nodes.router, ws_router):
    app.include_router(r)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/ready")
async def ready():
    """Lista para recibir tráfico: base de datos y Redis responden (sondas de Kubernetes / Caddy)."""
    from fastapi.responses import JSONResponse

    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        await bus.r().ping()
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)[:200]}, status_code=503)
    return {"ok": True}
