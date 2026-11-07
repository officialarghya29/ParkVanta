"""Small Redis facade with graceful degradation.

Redis is used for rate limiting and ephemeral state only. It is never the source
of truth, so a Redis outage degrades features instead of breaking the API.
"""

from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger("parkvanta.cache")

_client = None
_checked = False


def get_redis_client():
    global _client, _checked
    if _checked:
        return _client
    _checked = True
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=0.5)
        client.ping()
        _client = client
    except Exception as exc:  # pragma: no cover - depends on environment
        logger.warning("Redis unavailable, falling back to in-process state: %s", exc)
        _client = None
    return _client
