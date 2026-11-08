"""Fail a scheduled check when the outbox or a worker heartbeat is stale.

    python -m app.workers.health
    python -m app.workers.health --max-pending-minutes 5 --max-worker-age-minutes 3
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from app.database.session import session_scope
from app.services import worker_service

logger = logging.getLogger("parkvanta.workers.health")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-pending-minutes", type=int, default=None)
    parser.add_argument("--max-worker-age-minutes", type=int, default=None)
    args = parser.parse_args(argv)

    with session_scope() as session:
        report = worker_service.check_health(
            session,
            max_pending_minutes=args.max_pending_minutes,
            max_worker_age_minutes=args.max_worker_age_minutes,
        )

    print(json.dumps(report, indent=2, default=str))
    if not report["healthy"]:
        for problem in report["problems"]:
            print(f"UNHEALTHY: {problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - operational entry point
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())
