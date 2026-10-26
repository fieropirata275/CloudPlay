import base64
import hashlib
import hmac
import secrets
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import AsyncSession, get_db
from .models import User

_ph = PasswordHasher()
_bearer = HTTPBearer(auto_error=False)


def hash_password(p: str) -> str:
    return _ph.hash(p)


def verify_password(h: str, p: str) -> bool:
    try:
        return _ph.verify(h, p)
    except (VerificationError, InvalidHashError):
        return False


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def same_hash(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def new_secret(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


def make_jwt(user_id: str) -> str:
    t = int(time.time())
    payload = {"sub": user_id, "iat": t, "exp": t + settings.jwt_ttl_minutes * 60, "typ": "user"}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_jwt(token: str) -> dict | None:
    try:
        p = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return p if p.get("typ") == "user" else None


async def current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta token")
    payload = decode_jwt(cred.credentials)
    user = await db.get(User, payload["sub"]) if payload else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido")
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo administradores")
    return user


def _split(v: str) -> list[str]:
    return [x.strip() for x in v.split(",") if x.strip()]


def ice_servers(identity: str) -> list[dict]:
    """Credenciales TURN efímeras (draft-uberti-behave-turn-rest), compatibles con coturn use-auth-secret.
    Con CP_TURN_PROVIDER=cloudflare se devuelven las del TURN de Cloudflare (las renueva app.turn)."""
    from . import turn

    if settings.turn_provider == "cloudflare":
        cached = turn.cached()
        if cached:
            return cached
    servers: list[dict] = []
    if settings.stun_urls:
        servers.append({"urls": _split(settings.stun_urls)})
    if settings.turn_provider == "coturn" and settings.turn_urls and settings.turn_secret:
        username = f"{int(time.time()) + settings.turn_ttl}:{identity}"
        digest = hmac.new(settings.turn_secret.encode(), username.encode(), hashlib.sha1).digest()
        servers.append(
            {"urls": _split(settings.turn_urls), "username": username, "credential": base64.b64encode(digest).decode()}
        )
    return servers
