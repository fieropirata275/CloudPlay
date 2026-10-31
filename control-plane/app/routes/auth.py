"""Login clásico + flujo "device code" para TVs (como el de YouTube/Netflix):
la tele muestra un código corto, lo apruebas desde el móvil en /#/link."""
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import bus, mail
from ..config import settings
from ..db import AsyncSession, get_db
from ..models import User
from ..security import current_user, hash_password, make_jwt, sha256, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

DEVICE_TTL = 600
POLL_INTERVAL = 3
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O/1/I para teclear con el mando


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=256)


class Forgot(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class Reset(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=8, max_length=256)


class DeviceCode(BaseModel):
    device_code: str


class UserCode(BaseModel):
    user_code: str


def _token_response(user: User) -> dict:
    return {"access_token": make_jwt(user.id), "token_type": "bearer", "user": me_dict(user)}


def me_dict(user: User) -> dict:
    return {"id": user.id, "email": user.email, "is_admin": user.is_admin}


@router.post("/login")
async def login(body: Credentials, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Credenciales incorrectas")
    return _token_response(user)


@router.post("/register", status_code=201)
async def register(body: Credentials, db: AsyncSession = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(403, "Registro deshabilitado")
    email = body.email.lower().strip()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Ese email ya existe")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    mail.queue("welcome", email, {"email": email})
    return _token_response(user)


@router.get("/options")
async def options():
    """Lo que la pantalla de login puede ofrecer: registro y recuperar la contraseña por correo"""
    return {"registration": settings.allow_registration, "password_reset": mail.configured()}


async def _limited(key: str, limit: int) -> bool:
    r = bus.r()
    n = await r.incr(key)
    if n == 1:
        await r.expire(key, 3600)
    return n > limit


@router.post("/forgot")
async def forgot(body: Forgot, request: Request, db: AsyncSession = Depends(get_db)):
    """Manda un enlace para elegir contraseña nueva. Responde lo mismo exista o no la cuenta."""
    email = body.email.lower().strip()
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    if await _limited(f"forgot:ip:{sha256(ip)[:16]}", 10) or await _limited(f"forgot:mail:{sha256(email)[:16]}", 3):
        raise HTTPException(429, "Demasiados intentos. Prueba dentro de un rato.")
    user = await db.scalar(select(User).where(User.email == email))
    if user is not None and mail.configured():
        token = secrets.token_urlsafe(32)
        ttl = settings.reset_ttl_minutes * 60
        await bus.r().set(f"reset:{sha256(token)}", user.id, ex=ttl)
        link = f"{settings.public_url.rstrip('/')}/#/reset?token={token}"
        mail.queue("reset", email, {"email": email, "link": link, "minutes": settings.reset_ttl_minutes})
    return {"ok": True, "mail": mail.configured()}


@router.post("/reset")
async def reset(body: Reset, db: AsyncSession = Depends(get_db)):
    r = bus.r()
    key = f"reset:{sha256(body.token)}"
    user_id = await r.get(key)
    if not user_id:
        raise HTTPException(410, "El enlace ha caducado o ya se usó. Pide otro.")
    await r.delete(key)  # un solo uso
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(410, "La cuenta ya no existe")
    user.password_hash = hash_password(body.password)
    await db.commit()
    mail.queue("password_changed", user.email, {"email": user.email})
    return _token_response(user)


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return me_dict(user)


# ---------- Device flow ----------

@router.post("/device/start")
async def device_start():
    device_code = secrets.token_urlsafe(32)
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    user_code = f"{raw[:4]}-{raw[4:]}"
    r = bus.r()
    await r.set(f"dev:{device_code}", json.dumps({"user_code": user_code, "status": "pending"}), ex=DEVICE_TTL)
    await r.set(f"ucode:{user_code}", device_code, ex=DEVICE_TTL)
    return {
        "device_code": device_code,
        "user_code": user_code,
        "verification_uri": f"{settings.public_url.rstrip('/')}/#/link",
        "expires_in": DEVICE_TTL,
        "interval": POLL_INTERVAL,
    }


@router.post("/device/approve")
async def device_approve(body: UserCode, user: User = Depends(current_user)):
    code = body.user_code.strip().upper().replace(" ", "")
    if len(code) == 8:
        code = f"{code[:4]}-{code[4:]}"
    r = bus.r()
    device_code = await r.get(f"ucode:{code}")
    if not device_code:
        raise HTTPException(404, "Código no válido o caducado")
    raw = await r.get(f"dev:{device_code}")
    if not raw:
        raise HTTPException(404, "Código caducado")
    data = json.loads(raw)
    data.update(status="approved", user_id=user.id)
    ttl = await r.ttl(f"dev:{device_code}")
    await r.set(f"dev:{device_code}", json.dumps(data), ex=max(ttl, 30))
    await r.delete(f"ucode:{code}")
    return {"ok": True}


@router.post("/device/poll")
async def device_poll(body: DeviceCode, db: AsyncSession = Depends(get_db)):
    r = bus.r()
    raw = await r.get(f"dev:{body.device_code}")
    if not raw:
        raise HTTPException(410, "Código caducado")
    data = json.loads(raw)
    if data.get("status") != "approved":
        return {"status": "pending"}
    await r.delete(f"dev:{body.device_code}")  # un solo uso
    user = await db.get(User, data["user_id"])
    if user is None:
        raise HTTPException(410, "Usuario no encontrado")
    return {"status": "approved", **_token_response(user)}
