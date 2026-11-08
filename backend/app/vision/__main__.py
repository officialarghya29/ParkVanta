"""Score a vision prediction manifest against the pilot release gate.

    python -m app.vision path/to/manifest.json
    python -m app.vision manifest.json --min-samples 4 --min-plate-accuracy 0.95
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from app.vision.evaluation import VisionManifest, evaluate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.vision", description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--min-plate-accuracy", type=float, default=0.97)
    parser.add_argument("--min-occupancy-accuracy", type=float, default=0.95)
    parser.add_argument("--max-p95-ms", type=float, default=2500.0)
    parser.add_argument("--min-samples", type=int, default=100)
    parser.add_argument("--false-certain-confidence", type=float, default=0.90)
    args = parser.parse_args(argv)

    try:
        manifest = VisionManifest.model_validate_json(
            args.manifest.read_text(encoding="utf-8")
        )
    except OSError as exc:
        print(f"cannot read manifest: {exc}", file=sys.stderr)
        return 2
    except ValidationError as exc:
        print(f"invalid manifest: {exc}", file=sys.stderr)
        return 2

    report = evaluate(
        manifest,
        min_plate_accuracy=args.min_plate_accuracy,
        min_occupancy_accuracy=args.min_occupancy_accuracy,
        max_p95_ms=args.max_p95_ms,
        min_samples=args.min_samples,
        false_certain_confidence=args.false_certain_confidence,
    )
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        for failure in report["failures"]:
            print(f"GATE FAILED: {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
