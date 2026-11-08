"""Advisory realtime events with durable replay.

Every event is archived in PostgreSQL before it is published to Redis. Redis
Streams remain the low-latency fan-out and short retained window; the archive
is the replay source when a client has been disconnected beyond that window.
Events are notifications, never authority: clients refetch REST state.

Frame ids are archive sequence numbers. A reconnecting EventSource sends
`Last-Event-ID`, the stream replays archived events after that sequence, then
tails Redis. Without Redis, the in-process broker still carries live frames.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.core.cache import get_redis_client
from app.core.config import settings
from app.core.time import utcnow
from app.database.session import SessionLocal
from app.models import RealtimeEvent

logger = logging.getLogger("parkvanta.events")

STREAM_MAXLEN = 500

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


def _archive_event(event: dict, property_id: UUID) -> int | None:
    try:
        with SessionLocal() as db:
            row = RealtimeEvent(
                property_id=property_id,
                event_type=event["type"],
                payload=event,
                occurred_at=utcnow(),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return int(row.sequence)
    except Exception as exc:  # pragma: no cover - environment dependent
        logger.warning("Event archive write failed: %s", exc)
        return None


def publish_event(event_type: str, *, property_id: UUID, data: dict | None = None) -> str | None:
    """Archive and publish a property-scoped event. Returns its archive sequence."""
    event = {
        "id": str(uuid4()),
        "type": event_type,
        "property_id": str(property_id),
        "occurred_at": utcnow().isoformat(),
        "data": data or {},
    }
    sequence = _archive_event(event, property_id)
    if sequence is not None:
        event["sequence"] = sequence
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
            pipe.execute()
            return str(sequence) if sequence is not None else None
        except Exception as exc:  # pragma: no cover - depends on environment
            logger.warning("Redis publish failed, using local broker: %s", exc)

    _deliver_local(str(property_id), payload)
    return str(sequence) if sequence is not None else None


def archived_events(property_id: UUID, after_sequence: int = 0) -> list[dict]:
    """Return durable events after a sequence, oldest first."""
    with SessionLocal() as db:
        rows = db.scalars(
            select(RealtimeEvent)
            .where(
                RealtimeEvent.property_id == property_id,
                RealtimeEvent.sequence > after_sequence,
            )
            .order_by(RealtimeEvent.sequence)
        )
        events: list[dict] = []
        for row in rows:
            payload = dict(row.payload or {})
            payload["sequence"] = int(row.sequence)
            events.append(payload)
        return events


def latest_sequence(property_id: UUID) -> int:
    with SessionLocal() as db:
        return int(
            db.scalar(
                select(func.max(RealtimeEvent.sequence)).where(
                    RealtimeEvent.property_id == property_id
                )
            )
            or 0
        )


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
    sequence = event.get("sequence")
    return (
        f"id: {frame_id or sequence or event.get('id', '')}\n"
        f"event: {event.get('type', 'message')}\n"
        f"data: {payload}\n\n"
    )


def _parse_last_sequence(last_event_id: str | None) -> int | None:
    if last_event_id is None:
        return None
    try:
        value = int(last_event_id.strip())
    except (TypeError, ValueError):
        return None
    return max(0, value)


async def _get_async_client() -> Any:
    global _async_client, _async_checked, _async_loop
    loop = asyncio.get_running_loop()
    if _async_checked and _async_loop is not loop:
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
    """Yield SSE frames, replaying the durable archive before tailing live events."""
    yield ": connected\n\n"

    last_sequence = _parse_last_sequence(last_event_id)
    if last_sequence is not None:
        for event in await asyncio.to_thread(archived_events, property_id, last_sequence):
            last_sequence = int(event.get("sequence", last_sequence))
            yield _format_frame(json.dumps(event, default=str), str(last_sequence))
    else:
        last_sequence = await asyncio.to_thread(latest_sequence, property_id)

    client = await _get_async_client()
    if client is not None:
        cursor = "0-0"
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
                        if not payload:
                            continue
                        try:
                            event = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        sequence = event.get("sequence")
                        if sequence is not None:
                            sequence = int(sequence)
                            if sequence <= last_sequence:
                                continue
                            last_sequence = sequence
                        yield _format_frame(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - environment dependent
            logger.warning("Redis stream read failed, degrading to local broker: %s", exc)
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
