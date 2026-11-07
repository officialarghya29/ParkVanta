"""Advisory realtime events.

Events are notifications, never authority. A client that receives an event
re-reads state through the REST API; if the stream is unavailable the UI keeps
polling. Redis carries events between processes; without Redis a single-process
in-memory broker degrades gracefully.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

from app.core.cache import get_redis_client
from app.core.config import settings
from app.core.time import utcnow

logger = logging.getLogger("parkvanta.events")

_local_subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
_loop: asyncio.AbstractEventLoop | None = None
_async_client: Any = None
_async_checked = False


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def channel_for(property_id: UUID | str) -> str:
    return f"pv:events:{property_id}"


def publish_event(event_type: str, *, property_id: UUID, data: dict | None = None) -> None:
    """Publish a property-scoped event. Safe to call from sync request paths."""
    event = {
        "id": str(uuid4()),
        "type": event_type,
        "property_id": str(property_id),
        "occurred_at": utcnow().isoformat(),
        "data": data or {},
    }
    payload = json.dumps(event, default=str)

    client = get_redis_client()
    if client is not None:
        try:
            client.publish(channel_for(property_id), payload)
            return
        except Exception as exc:  # pragma: no cover - depends on environment
            logger.warning("Redis publish failed, using local broker: %s", exc)

    _deliver_local(str(property_id), payload)


def _deliver_local(property_id: str, payload: str) -> None:
    queues = list(_local_subscribers.get(property_id, ()))
    if not queues:
        return

    def push() -> None:
        for queue in queues:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:  # pragma: no cover - slow consumer
                pass

    if _loop is not None and not _loop.is_closed():
        _loop.call_soon_threadsafe(push)


def _format_frame(payload: str) -> str:
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        return f"data: {payload}\n\n"
    return (
        f"id: {event.get('id', '')}\n"
        f"event: {event.get('type', 'message')}\n"
        f"data: {payload}\n\n"
    )


async def _get_async_client() -> Any:
    global _async_client, _async_checked
    if _async_checked:
        return _async_client
    _async_checked = True
    try:
        import redis.asyncio as redis_async

        client = redis_async.Redis.from_url(
            settings.redis_url, decode_responses=True, socket_timeout=5
        )
        await client.ping()
        _async_client = client
    except Exception as exc:  # pragma: no cover - depends on environment
        logger.warning("Redis stream unavailable, using local broker: %s", exc)
        _async_client = None
    return _async_client


async def event_stream(property_id: UUID) -> AsyncIterator[str]:
    """Yield SSE frames for one property until the client disconnects."""
    yield ": connected\n\n"

    client = await _get_async_client()
    if client is not None:
        pubsub = client.pubsub()
        await pubsub.subscribe(channel_for(property_id))
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
                if message and message.get("type") == "message":
                    yield _format_frame(message["data"])
                else:
                    yield ": keepalive\n\n"
        finally:
            try:
                await pubsub.unsubscribe(channel_for(property_id))
                closer = getattr(pubsub, "aclose", None) or getattr(pubsub, "close")
                await closer()
            except Exception:  # pragma: no cover - best-effort cleanup
                pass
        return

    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
    key = str(property_id)
    _local_subscribers[key].add(queue)
    try:
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=15)
                yield _format_frame(payload)
            except TimeoutError:
                yield ": keepalive\n\n"
    finally:
        _local_subscribers[key].discard(queue)
