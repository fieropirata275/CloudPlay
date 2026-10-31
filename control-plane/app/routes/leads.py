"""Formulario de "Solicitar demo" de la landing. Público, con honeypot y límite por IP."""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import bus, mail
from ..db import AsyncSession, get_db
from ..models import Lead
from ..security import sha256

router = APIRouter(prefix="/api/leads", tags=["leads"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
LIMIT_PER_HOUR = 5


class LeadIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=255)
    company: str | None = Field(default=None, max_length=160)
    players: str | None = Field(default=None, max_length=32)
    message: str | None = Field(default=None, max_length=2000)
    website: str | None = None  # honeypot: los humanos no lo ven ni lo rellenan


@router.post("", status_code=201)
async def create_lead(body: LeadIn, request: Request, db: AsyncSession = Depends(get_db)):
    if body.website:  # bot: respondemos OK sin guardar nada
        return {"ok": True}
    if not EMAIL.match(body.email.strip()):
        raise HTTPException(422, "Revisa el email: no parece válido")
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    key = f"leads:{sha256(ip)[:16]}"
    r = bus.r()
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 3600)
    if n > LIMIT_PER_HOUR:
        raise HTTPException(429, "Has enviado varias solicitudes seguidas. Prueba dentro de un rato.")
    db.add(Lead(
        name=body.name.strip(), email=body.email.strip().lower(),
        company=(body.company or "").strip() or None, players=(body.players or "").strip() or None,
        message=(body.message or "").strip() or None,
    ))
    await db.commit()
    ctx = {"name": body.name.strip(), "email": body.email.strip().lower(), "company": (body.company or "").strip(),
           "players": (body.players or "").strip(), "message": (body.message or "").strip()}
    mail.queue("lead_ack", ctx["email"], ctx)
    await mail.queue_admins("lead", ctx)
    return {"ok": True}
