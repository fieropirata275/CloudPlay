"""Servidor de desarrollo SIN Docker: SQLite + Redis falso en memoria + cliente web en /.

  pip install -r requirements.txt aiosqlite fakeredis
  python devserver.py            -> http://localhost:8000   (admin@local / devpassword)

Sirve para trabajar en la UI y la API. Para jugar de verdad necesitas un nodo worker.
"""
import os
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.environ.setdefault("CP_DATABASE_URL", "sqlite+aiosqlite:///./dev.db")
os.environ.setdefault("CP_PUBLIC_URL", f"http://localhost:{PORT}")
os.environ.setdefault("CP_ADMIN_EMAIL", "admin@local")
os.environ.setdefault("CP_ADMIN_PASSWORD", "devpassword")
os.environ.setdefault("CP_JWT_SECRET", "dev-only-secret")

import asyncio  # noqa: E402

import fakeredis  # noqa: E402
import uvicorn  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import bus  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app, init_db  # noqa: E402
from app.models import Game  # noqa: E402

DEMO = [
    ("ps2", "ps2/Demo Racer (EU).iso"), ("ps2", "ps2/Monster Hunt Saga.iso"), ("ps2", "ps2/Sky Pirates.chd"),
    ("gc", "gc/Island Adventure.rvz"), ("gc", "gc/Kart Showdown.iso"), ("wii", "wii/Party Islands.wbfs"),
    ("wii", "wii/Sword Legends.rvz"), ("ps2", "ps2/Neon Streets.iso"),
]


async def seed():
    from app.ws import clean_title

    await init_db()
    async with SessionLocal() as db:
        if not (await db.scalars(select(Game))).first():
            for p, path in DEMO:
                db.add(Game(platform=p, rom_path=path, title=clean_title(path)))
            await db.commit()


if __name__ == "__main__":
    bus.set_client(fakeredis.FakeAsyncRedis(decode_responses=True))
    asyncio.run(seed())
    web = Path(__file__).resolve().parent.parent / "clients" / "web"
    app.mount("/", StaticFiles(directory=web, html=True), name="web")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
