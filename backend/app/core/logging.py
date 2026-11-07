import logging
import sys


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt='{"level":"%(levelname)s","logger":"%(name)s","message":"%(message)s","time":"%(asctime)s"}',
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # Keep third-party noise down while preserving actionable errors.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
