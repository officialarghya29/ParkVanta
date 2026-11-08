import pytest

from app.core import cache as cache_module
from app.core.errors import RateLimitError
from app.core.rate_limit import SlidingWindowRateLimiter


class BrokenRedis:
    def pipeline(self):
        raise ConnectionError("redis is down")


def test_redis_failure_falls_back_to_process_limit():
    limiter = SlidingWindowRateLimiter(limit=2, window_seconds=60)
    limiter._redis = BrokenRedis()

    try:
        limiter.hit("login:203.0.113.9")
        limiter.hit("login:203.0.113.9")
        with pytest.raises(RateLimitError):
            limiter.hit("login:203.0.113.9")
    finally:
        # The production reset starts a short cooldown; tests must not poison
        # the process-wide Redis cache used by later realtime tests.
        with cache_module._lock:
            cache_module._client = None
            cache_module._next_attempt_at = 0.0
