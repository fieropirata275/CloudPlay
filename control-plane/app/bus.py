"""Bus de mensajes sobre Redis pub/sub.

Permite tener varias réplicas de la API: el WebSocket de un agente o de un
peer de señalización puede vivir en cualquier réplica y los mensajes llegan
igual porque todo se enruta por canales de Redis:

  node:{node_id}          comandos para el agente de un nodo
  sig:{session_id}:{role} mensajes de señalización para client|worker
"""
import json
from contextlib import asynccontextmanager

import redis.asyncio as aioredis

from .config import settings

_redis: aioredis.Redis | None = None


def r() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def set_client(client) -> None:  # usado en tests (fakeredis)
    global _redis
    _redis = client


async def publish(channel: str, msg: dict) -> None:
    await r().publish(channel, json.dumps(msg))


@asynccontextmanager
async def subscribe(*channels: str):
    ps = r().pubsub()
    await ps.subscribe(*channels)
    try:
        yield ps
    finally:
        try:
            await ps.unsubscribe(*channels)
        finally:
            await ps.aclose()


async def messages(ps):
    async for m in ps.listen():
        if m.get("type") == "message":
            try:
                yield json.loads(m["data"])
            except (TypeError, ValueError):
                continue


async def close() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
