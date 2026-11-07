#!/usr/bin/env python3
"""Measure ParkVanta read-path throughput against a running API.

This is a real load generator, not a mock: every iteration performs an
authenticated HTTP request. Results are written as JSON so the README can quote
measurements with their environment and date.

    python scripts/load_test.py --concurrency 20 --duration 20 \
        --output docs/benchmarks/local-20c.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import platform
import random
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import httpx

WEIGHTS = [
    (40, "availability", "/parking/availability?property_id={property_id}"),
    (30, "overview", "/analytics/overview?property_id={property_id}"),
    (20, "active_visitors", "/gate/active-visitors"),
    (10, "recent_activity", "/gate/recent-activity?limit=8"),
]


def cpu_model() -> str:
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine()


def percentile(values: list[float], point: int) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil((point / 100) * len(ordered)))
    return ordered[rank - 1]


def summarize(values: list[float]) -> dict:
    if not values:
        return {"count": 0, "mean_ms": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0, "max_ms": 0}
    return {
        "count": len(values),
        "mean_ms": round(sum(values) / len(values), 2),
        "p50_ms": round(percentile(values, 50), 2),
        "p95_ms": round(percentile(values, 95), 2),
        "p99_ms": round(percentile(values, 99), 2),
        "max_ms": round(max(values), 2),
    }


async def run(args: argparse.Namespace) -> dict:
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30.0) as client:
        login = await client.post(
            "/auth/login", json={"email": args.email, "password": args.password}
        )
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        me = await client.get("/auth/me", headers=headers)
        me.raise_for_status()
        property_id = me.json()["property_id"]
        if not property_id:
            raise SystemExit("The load-test account needs a property assignment")

    weighted: list[str] = []
    paths: dict[str, str] = {}
    for weight, name, path in WEIGHTS:
        weighted.extend([name] * weight)
        paths[name] = path.format(property_id=property_id)

    deadline = time.perf_counter() + args.duration
    latencies: dict[str, list[float]] = defaultdict(list)
    status_counts: dict[str, int] = defaultdict(int)
    timeline: dict[int, dict[str, int]] = defaultdict(lambda: {"requests": 0, "errors": 0})
    errors = 0
    started_at = time.time()

    limits = httpx.Limits(
        max_connections=args.concurrency, max_keepalive_connections=args.concurrency
    )
    async with httpx.AsyncClient(
        base_url=args.base_url, headers=headers, timeout=30.0, limits=limits
    ) as client:
        async def worker() -> None:
            nonlocal errors
            while time.perf_counter() < deadline:
                name = random.choice(weighted)
                bucket = int(time.time())
                began = time.perf_counter()
                try:
                    response = await client.get(paths[name])
                    elapsed = (time.perf_counter() - began) * 1000
                    latencies[name].append(elapsed)
                    status_counts[str(response.status_code)] += 1
                    timeline[bucket]["requests"] += 1
                    if response.status_code >= 400:
                        errors += 1
                        timeline[bucket]["errors"] += 1
                except Exception:
                    errors += 1
                    timeline[bucket]["errors"] += 1

        tasks = [asyncio.create_task(worker()) for _ in range(args.concurrency)]
        await asyncio.gather(*tasks)

    elapsed_seconds = max(time.time() - started_at, 0.001)
    all_latencies = [value for values in latencies.values() for value in values]
    attempts = len(all_latencies) + errors
    per_endpoint = {name: summarize(values) for name, values in latencies.items()}
    summary = summarize(all_latencies)

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "target": args.base_url,
        "environment": {
            "host": platform.node(),
            "platform": platform.platform(),
            "cpu": cpu_model(),
            "cpu_count": os.cpu_count(),
            "python": platform.python_version(),
            "postgres": "16 (Docker, local port 55432)",
            "redis": "7 (Docker, local port 56379)",
        },
        "scenario": {
            "concurrency": args.concurrency,
            "duration_seconds": args.duration,
            "mix": {name: weight for weight, name, _path in WEIGHTS},
            "endpoints": paths,
        },
        "totals": {
            "requests": attempts,
            "successful": len(all_latencies),
            "errors": errors,
            "error_rate_percent": round((errors / attempts) * 100, 3) if attempts else 0,
            "rps": round(attempts / elapsed_seconds, 2),
            "elapsed_seconds": round(elapsed_seconds, 2),
            "status_counts": dict(status_counts),
        },
        "latency_ms": summary,
        "per_endpoint": per_endpoint,
        "timeline": [
            {"epoch_second": second, **counts}
            for second, counts in sorted(timeline.items())
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="ParkVanta HTTP load test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8092/api/v1")
    parser.add_argument("--email", default="admin@skyline.dev")
    parser.add_argument("--password", default="ParkVanta@2026")
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--duration", type=int, default=20)
    parser.add_argument("--output", default="docs/benchmarks/local.json")
    args = parser.parse_args()

    result = asyncio.run(run(args))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    totals = result["totals"]
    latency = result["latency_ms"]
    print("ParkVanta load test")
    print(f"  target       {result['target']}")
    print(f"  concurrency  {args.concurrency} · duration {totals['elapsed_seconds']}s")
    print(f"  requests     {totals['requests']} · {totals['rps']} req/s")
    print(f"  errors       {totals['errors']} ({totals['error_rate_percent']}%)")
    print(
        "  latency      "
        f"p50 {latency['p50_ms']}ms · p95 {latency['p95_ms']}ms · p99 {latency['p99_ms']}ms"
    )
    print(f"  written      {output}")


if __name__ == "__main__":
    main()
