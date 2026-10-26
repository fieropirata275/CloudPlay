"""TURN gestionado de Cloudflare (Realtime TURN).

Con Cloudflare Tunnel no hay puertos UDP abiertos en tu red: el vídeo de la partida viaja por el TURN de
Cloudflare. Las credenciales se piden a su API y se renuevan en segundo plano antes de caducar.
Docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/
"""
import asyncio
import json
import logging
import time
import urllib.request

from .config import settings

log = logging.getLogger("cloudplay.turn")
API = "https://rtc.live.cloudflare.com/v1/turn/keys/{key}/credentials/generate-ice-servers"

_cache: dict = {"servers": [], "expires": 0.0}


def cached() -> list[dict]:
    return _cache["servers"] if time.time() < _cache["expires"] else []


def _clean(servers: list[dict]) -> list[dict]:
    """Quita las URLs del puerto 53: los navegadores las bloquean y solo hacen esperar a ICE."""
    out = []
    for s in servers:
        urls = s.get("urls")
        urls = [urls] if isinstance(urls, str) else list(urls or [])
        urls = [u for u in urls if ":53?" not in u and not u.endswith(":53")]
        if urls:
            out.append({**s, "urls": urls})
    return out


def _fetch() -> list[dict]:
    req = urllib.request.Request(
        API.format(key=settings.cf_turn_key_id),
        data=json.dumps({"ttl": settings.cf_turn_ttl}).encode(),
        headers={"Authorization": f"Bearer {settings.cf_turn_api_token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        body = json.loads(r.read())
    return _clean(body.get("iceServers") or [])


async def refresh_once() -> bool:
    try:
        servers = await asyncio.to_thread(_fetch)
    except Exception as e:  # noqa: BLE001
        log.warning("no se pudieron pedir credenciales TURN a Cloudflare: %s", e)
        return False
    if servers:
        # Se usan durante la mitad de su vida: una partida que empieza justo antes de renovar aún tiene horas
        _cache.update(servers=servers, expires=time.time() + settings.cf_turn_ttl / 2)
        return True
    return False


async def turn_loop() -> None:
    if settings.turn_provider != "cloudflare":
        return
    if not (settings.cf_turn_key_id and settings.cf_turn_api_token):
        log.error("CP_TURN_PROVIDER=cloudflare pero faltan CP_CF_TURN_KEY_ID / CP_CF_TURN_API_TOKEN")
        return
    while True:
        ok = await refresh_once()
        await asyncio.sleep(settings.cf_turn_ttl / 4 if ok else 30)
