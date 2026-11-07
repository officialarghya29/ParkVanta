import time
from collections import defaultdict, deque
from threading import Lock

from app.core.cache import get_redis_client
from app.core.errors import RateLimitError


class SlidingWindowRateLimiter:
    """Rate limiter backed by Redis when available, in-process otherwise.

    Both paths enforce the same window semantics; the in-process path is a
    per-worker safeguard, which is sufficient for local development.
    """

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._redis = get_redis_client()

    def hit(self, key: str) -> None:
        now = time.time()
        if self._redis is not None:
            redis_key = f"pv:rl:{key}"
            pipe = self._redis.pipeline()
            pipe.incr(redis_key)
            pipe.expire(redis_key, self.window_seconds, nx=True)
            count, _ = pipe.execute()
            if int(count) > self.limit:
                raise RateLimitError()
            return

        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise RateLimitError()
            bucket.append(now)

    @staticmethod
    def key_for(scope: str, *parts: str) -> str:
        return ":".join([scope, *[p or "-" for p in parts]])
