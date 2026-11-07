from datetime import UTC, datetime
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def minutes_between(start: datetime, end: datetime) -> int:
    return int((ensure_utc(end) - ensure_utc(start)).total_seconds() // 60)


def local_now(timezone: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(timezone))
    except Exception:
        return datetime.now(UTC)
