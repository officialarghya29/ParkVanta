"""Fail a go-live check when the deployment is not production-ready.

    python -m app.pilot_preflight
"""

from __future__ import annotations

import argparse
import json
import sys

from app.database.session import session_scope
from app.services import preflight_service


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.pilot_preflight", description=__doc__)
    parser.parse_args(argv)

    with session_scope() as session:
        report = preflight_service.run_preflight(session)

    print(json.dumps(report, indent=2))
    if not report["ready"]:
        for blocker in report["blockers"]:
            print(f"BLOCKED: {blocker}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
