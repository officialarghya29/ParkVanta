"""Small Redis facade with graceful degradation.

Redis is used for rate limiting and ephemeral state only. It is never the source
of truth, so a Redis outage degrades features instead of breaking the API.
"""

from __future__ import annotations

import logging
import threading
import time

from app.core.config import settings

logger = logging.getLogger("parkvanta.cache")

_client = None
_next_attempt_at = 0.0
_lock = threading.Lock()
RETRY_SECONDS = 30.0


def get_redis_client():
    global _client, _next_attempt_at
    if _client is not None:
        return _client
    if time.monotonic() < _next_attempt_at:
        return None
    with _lock:
        if _client is not None:
            return _client
        if time.monotonic() < _next_attempt_at:
            return None
        try:
            import redis

            client = redis.Redis.from_url(
                settings.redis_url, decode_responses=True, socket_timeout=0.5
            )
            client.ping()
            _client = client
        except Exception as exc:  # pragma: no cover - depends on environment
            logger.warning("Redis unavailable, falling back to in-process state: %s", exc)
            _next_attempt_at = time.monotonic() + RETRY_SECONDS
    return _client


def reset_redis_client() -> None:
    """Discard a failed client and retry after a short cooldown."""
    global _client, _next_attempt_at
    with _lock:
        _client = None
        _next_attempt_at = time.monotonic() + RETRY_SECONDS
