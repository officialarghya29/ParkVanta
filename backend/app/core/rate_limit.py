import logging
import secrets
import time
from collections import defaultdict, deque
from threading import Lock

from app.core.cache import get_redis_client, reset_redis_client
from app.core.errors import RateLimitError

logger = logging.getLogger("parkvanta.rate_limit")


class SlidingWindowRateLimiter:
    """Rate limiter backed by Redis when available, in-process otherwise.

    Both paths use the same sliding-window semantics. Redis is advisory: if it
    becomes unavailable mid-request, the limiter degrades to the per-worker
    safeguard instead of returning a 500.
    """

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._redis = get_redis_client()
        self._redis_retry_at = 0.0

    def hit(self, key: str) -> None:
        now = time.time()
        if self._redis is None and now >= self._redis_retry_at:
            self._redis = get_redis_client()
        if self._redis is not None:
            redis_key = f"pv:rl:{key}"
            member = f"{now}:{secrets.token_hex(4)}"
            try:
                pipe = self._redis.pipeline()
                pipe.zremrangebyscore(redis_key, 0, now - self.window_seconds)
                pipe.zadd(redis_key, {member: now})
                pipe.zcard(redis_key)
                pipe.expire(redis_key, self.window_seconds)
                _, _, count, _ = pipe.execute()
                if int(count) > self.limit:
                    raise RateLimitError()
                return
            except RateLimitError:
                raise
            except Exception as exc:
                logger.warning("Redis rate limit unavailable, using local fallback: %s", exc)
                reset_redis_client()
                self._redis = None
                self._redis_retry_at = now + 30.0

        with self._lock:
            if len(self._events) > 4096:
                self._prune(now)
            bucket = self._events[key]
            while bucket and now - bucket[0] > self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise RateLimitError()
            bucket.append(now)

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        stale = [key for key, bucket in self._events.items() if not bucket or bucket[-1] < cutoff]
        for key in stale:
            self._events.pop(key, None)

    @staticmethod
    def key_for(scope: str, *parts: str) -> str:
        return ":".join([scope, *[p or "-" for p in parts]])
