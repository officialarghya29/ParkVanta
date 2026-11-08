import logging
import sys

from app.core.request_context import current_request_id


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = current_request_id()
        return True


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(_RequestIdFilter())
    handler.setFormatter(
        logging.Formatter(
            fmt='{"level":"%(levelname)s","logger":"%(name)s","request_id":"%(request_id)s","message":"%(message)s","time":"%(asctime)s"}',
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # Keep third-party noise down while preserving actionable errors.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
