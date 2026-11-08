"""Offline scoring for exported ANPR and occupancy predictions.

This module does not run inference. It scores a manifest of predictions
against labelled ground truth so a candidate model can be rejected before it
is ever connected to a gate. Results apply only to the scored manifest.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator

_NON_PLATE = re.compile(r"[^A-Z0-9]")


def normalize_plate(value: str) -> str:
    return _NON_PLATE.sub("", value.upper())


class OccupancyLabel(StrEnum):
    OCCUPIED = "OCCUPIED"
    FREE = "FREE"


class VisionCase(BaseModel):
    condition: str = Field(min_length=1, max_length=40)
    plate_truth: str = Field(min_length=4, max_length=20)
    plate_prediction: str | None = Field(default=None, max_length=20)
    plate_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    occupancy_truth: OccupancyLabel
    occupancy_prediction: OccupancyLabel | None = None
    latency_ms: float = Field(ge=0.0)


class VisionManifest(BaseModel):
    dataset: str = Field(min_length=1, max_length=120)
    model_name: str = Field(min_length=1, max_length=120)
    model_version: str = Field(min_length=1, max_length=60)
    captured_at: datetime | None = None
    cases: list[VisionCase]

    @field_validator("cases")
    @classmethod
    def _at_least_one_case(cls, value: list[VisionCase]) -> list[VisionCase]:
        if not value:
            raise ValueError("manifest must contain at least one case")
        return value


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = max(0, math.ceil(percentile / 100 * len(ordered)) - 1)
    return float(ordered[index])


def evaluate(
    manifest: VisionManifest,
    *,
    min_plate_accuracy: float = 0.97,
    min_occupancy_accuracy: float = 0.95,
    max_p95_ms: float = 2500.0,
    min_samples: int = 100,
    false_certain_confidence: float = 0.90,
) -> dict:
    """Score a manifest and apply the pilot release gate."""
    plate_hits = 0
    occupancy_hits = 0
    false_certain = 0
    latencies: list[float] = []
    by_condition: dict[str, dict[str, int]] = defaultdict(
        lambda: {"samples": 0, "plate_hits": 0, "occupancy_hits": 0}
    )

    for case in manifest.cases:
        truth = normalize_plate(case.plate_truth)
        prediction = normalize_plate(case.plate_prediction or "")
        plate_ok = bool(prediction) and prediction == truth
        occupancy_ok = case.occupancy_prediction == case.occupancy_truth
        if not plate_ok and case.plate_prediction is not None:
            if case.plate_confidence >= false_certain_confidence:
                false_certain += 1

        plate_hits += int(plate_ok)
        occupancy_hits += int(occupancy_ok)
        latencies.append(case.latency_ms)

        bucket = by_condition[case.condition]
        bucket["samples"] += 1
        bucket["plate_hits"] += int(plate_ok)
        bucket["occupancy_hits"] += int(occupancy_ok)

    sample_count = len(manifest.cases)
    plate_accuracy = plate_hits / sample_count
    occupancy_accuracy = occupancy_hits / sample_count
    p95_latency = _percentile(latencies, 95)

    checks = {
        "minimum_samples": sample_count >= min_samples,
        "plate_accuracy": plate_accuracy >= min_plate_accuracy,
        "occupancy_accuracy": occupancy_accuracy >= min_occupancy_accuracy,
        "p95_latency": p95_latency <= max_p95_ms,
        "no_false_certain_reads": false_certain == 0,
    }
    failures = [name for name, passed in checks.items() if not passed]

    per_condition = {
        condition: {
            "samples": values["samples"],
            "plate_accuracy": round(values["plate_hits"] / values["samples"], 4),
            "occupancy_accuracy": round(
                values["occupancy_hits"] / values["samples"], 4
            ),
        }
        for condition, values in sorted(by_condition.items())
    }

    return {
        "dataset": manifest.dataset,
        "model": {"name": manifest.model_name, "version": manifest.model_version},
        "sample_count": sample_count,
        "metrics": {
            "plate_accuracy": round(plate_accuracy, 4),
            "occupancy_accuracy": round(occupancy_accuracy, 4),
            "p95_latency_ms": round(p95_latency, 1),
            "false_certain_reads": false_certain,
        },
        "per_condition": per_condition,
        "thresholds": {
            "min_plate_accuracy": min_plate_accuracy,
            "min_occupancy_accuracy": min_occupancy_accuracy,
            "max_p95_ms": max_p95_ms,
            "min_samples": min_samples,
            "false_certain_confidence": false_certain_confidence,
        },
        "checks": checks,
        "passed": not failures,
        "failures": failures,
    }
