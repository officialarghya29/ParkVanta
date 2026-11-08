"""Per-request correlation ids shared by middleware and structured logs."""

import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def current_request_id() -> str:
    return _request_id.get()


@contextmanager
def bind_request_id(value: str | None) -> Iterator[str]:
    """Accept a caller-supplied id when safe, otherwise generate one."""
    request_id = value if value and _VALID_REQUEST_ID.fullmatch(value) else uuid.uuid4().hex
    token = _request_id.set(request_id)
    try:
        yield request_id
    finally:
        _request_id.reset(token)
