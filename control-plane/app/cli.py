"""CLI de administración.

  python -m app.cli create-user --email a@b.c --password xxxxxxxx [--admin]
  python -m app.cli create-node --name gpu-01 --capacity 4 --platforms ps2,gc,wii
"""
import argparse
import asyncio

from sqlalchemy import select

from .db import SessionLocal
from .main import init_db
from .models import User
from .routes.admin import create_node
from .security import hash_password


async def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("create-user")
    u.add_argument("--email", required=True)
    u.add_argument("--password", required=True)
    u.add_argument("--admin", action="store_true")
    u.add_argument("--max-sessions", type=int, default=1)
    n = sub.add_parser("create-node")
    n.add_argument("--name", required=True)
    n.add_argument("--capacity", type=int, default=2)
    n.add_argument("--platforms", default="ps2,gc,wii")
    a = ap.parse_args()

    await init_db()
    async with SessionLocal() as db:
        if a.cmd == "create-user":
            email = a.email.lower()
            if await db.scalar(select(User).where(User.email == email)):
                raise SystemExit("Ese usuario ya existe")
            db.add(User(email=email, password_hash=hash_password(a.password), is_admin=a.admin, max_sessions=a.max_sessions))
            await db.commit()
            print(f"Usuario creado: {email}")
        else:
            node, token = await create_node(db, a.name, a.capacity, a.platforms.split(","))
            print(f"Nodo '{node.name}' creado.\nNODE_TOKEN={token}\n(Guárdalo, no se vuelve a mostrar)")


if __name__ == "__main__":
    asyncio.run(main())
