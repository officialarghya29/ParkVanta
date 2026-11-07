"""Advisory realtime events.

Events are notifications, never authority. A client that receives an event
re-reads state through the REST API; if the stream is unavailable the UI keeps
polling. Redis carries events between processes and keeps a bounded replay
window in a Stream; without Redis a single-process in-memory broker degrades
gracefully (live only).

Frame ids are Redis Stream ids, so a reconnecting EventSource can resume with
`Last-Event-ID` and receive the frames it missed. Clients may also pass
`?last_event_id=` because the browser client mints a fresh EventSource when the
short-lived stream ticket is renewed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

from app.core.cache import get_redis_client
from app.core.config import settings
from app.core.time import utcnow

logger = logging.getLogger("parkvanta.events")

STREAM_MAXLEN = 500
_STREAM_ID = re.compile(r"^\d{1,20}-\d{1,20}$")

_local_subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
_loop: asyncio.AbstractEventLoop | None = None
_async_client: Any = None
_async_checked = False
_async_loop: Any = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def channel_for(property_id: UUID | str) -> str:
    return f"pv:events:{property_id}"


def stream_key(property_id: UUID | str) -> str:
    return f"pv:stream:{property_id}"


def publish_event(event_type: str, *, property_id: UUID, data: dict | None = None) -> str | None:
    """Publish a property-scoped event. Safe to call from sync request paths.

    Returns the Redis Stream id when Redis accepted the event, otherwise None.
    """
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
            pipe = client.pipeline()
            pipe.xadd(
                stream_key(property_id),
                {"payload": payload},
                maxlen=STREAM_MAXLEN,
                approximate=True,
            )
            pipe.publish(channel_for(property_id), payload)
            results = pipe.execute()
            return str(results[0]) if results else None
        except Exception as exc:  # pragma: no cover - depends on environment
            logger.warning("Redis publish failed, using local broker: %s", exc)

    _deliver_local(str(property_id), payload)
    return None


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


def _format_frame(payload: str, frame_id: str | None = None) -> str:
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        return f"data: {payload}\n\n"
    return (
        f"id: {frame_id or event.get('id', '')}\n"
        f"event: {event.get('type', 'message')}\n"
        f"data: {payload}\n\n"
    )


def _cursor_after(last_event_id: str | None) -> str:
    """Resume after a real stream id; otherwise only tail new events."""
    if last_event_id and _STREAM_ID.match(last_event_id.strip()):
        return last_event_id.strip()
    return "$"


async def _get_async_client() -> Any:
    global _async_client, _async_checked, _async_loop
    loop = asyncio.get_running_loop()
    if _async_checked and _async_loop is not loop:
        # A Redis asyncio client is bound to the loop that created it. Tests and
        # worker runtimes may create more than one loop per process.
        _async_client = None
        _async_checked = False
    if _async_checked:
        return _async_client
    _async_checked = True
    _async_loop = loop
    try:
        import redis.asyncio as redis_async

        client = redis_async.Redis.from_url(
            settings.redis_url, decode_responses=True, socket_timeout=20
        )
        await client.ping()
        _async_client = client
    except Exception as exc:  # pragma: no cover - depends on environment
        logger.warning("Redis stream unavailable, using local broker: %s", exc)
        _async_client = None
    return _async_client


async def event_stream(
    property_id: UUID, last_event_id: str | None = None
) -> AsyncIterator[str]:
    """Yield SSE frames for one property until the client disconnects.

    Uses XREAD on the property Stream, which replays retained frames after
    `last_event_id` and then tails live events in order.
    """
    yield ": connected\n\n"

    client = await _get_async_client()
    if client is not None:
        cursor = _cursor_after(last_event_id)
        key = stream_key(property_id)
        try:
            while True:
                result = await client.xread({key: cursor}, block=15000, count=100)
                if not result:
                    yield ": keepalive\n\n"
                    continue
                for _stream_name, messages in result:
                    for message_id, fields in messages:
                        cursor = message_id
                        payload = fields.get("payload") if isinstance(fields, dict) else None
                        if payload:
                            yield _format_frame(payload, message_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - environment dependent
            logger.warning("Redis stream read failed, degrading to local broker: %s", exc)
        # Fall through to the in-process broker rather than dropping the client.
        async for frame in _local_stream(property_id):
            yield frame
        return

    async for frame in _local_stream(property_id):
        yield frame


async def _local_stream(property_id: UUID) -> AsyncIterator[str]:
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
