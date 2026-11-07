#!/usr/bin/env python3
"""Measure ParkVanta's write path with real authenticated HTTP traffic.

Two phases run against an isolated, freshly seeded benchmark database:

1. Gate cycles: prepared, approved visits are authorized, confirmed and
   released concurrently. Every step is a real API write.
2. Allocation contention: many approvals race for a deliberately small pool
   of free bays. Exactly the free-bay count may succeed; the rest must receive
   `no_slot_available`.

The script also queries PostgreSQL afterwards for duplicate active
reservations/occupancies and lifecycle event counts. It does not mock the API.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import platform
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx


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


def fail(context: str, response: httpx.Response) -> None:
    raise SystemExit(f"{context} -> HTTP {response.status_code}: {response.text[:600]}")


def expect(response: httpx.Response, status: int, context: str) -> dict:
    if response.status_code != status:
        fail(context, response)
    return response.json()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def login(client: httpx.AsyncClient, email: str, password: str) -> str:
    response = await client.post("/auth/login", json={"email": email, "password": password})
    return expect(response, 200, f"login {email}")["access_token"]


async def setup(
    client: httpx.AsyncClient, args: argparse.Namespace
) -> tuple[dict[str, str], UUID, list[dict], list[str]]:
    admin = await login(client, args.admin_email, args.password)
    resident = await login(client, args.resident_email, args.password)
    guard = await login(client, args.guard_email, args.password)
    tokens = {"admin": admin, "resident": resident, "guard": guard}

    me = expect(await client.get("/auth/me", headers=auth(admin)), 200, "admin identity")
    property_id = UUID(me["property_id"])
    print(f"  property     {property_id}")

    policy = expect(
        await client.patch(
            f"/properties/{property_id}/policy",
            headers=auth(admin),
            json={
                "max_active_visitors": 5000,
                "visitor_window_start": "00:00",
                "visitor_window_end": "23:59",
            },
        ),
        200,
        "update benchmark policy",
    )
    print(f"  policy       max_active={policy['max_active_visitors']}")

    zone = expect(
        await client.post(
            "/parking/zones",
            headers=auth(admin),
            json={
                "property_id": str(property_id),
                "name": "Benchmark Overflow",
                "level": "Bench",
                "category": "VISITOR",
                "priority": 1,
            },
        ),
        201,
        "create benchmark zone",
    )
    zone_id = UUID(zone["id"])

    total_slots = args.gate_cycles + args.contention_free_slots
    for index in range(1, total_slots + 1):
        expect(
            await client.post(
                "/parking/slots",
                headers=auth(admin),
                json={
                    "property_id": str(property_id),
                    "zone_id": str(zone_id),
                    "code": f"B-{index:03d}",
                    "vehicle_category": "FOUR_WHEELER",
                },
            ),
            201,
            f"create benchmark slot B-{index:03d}",
        )
    print(f"  slots        {total_slots} benchmark bays")

    slots = expect(
        await client.get(
            f"/parking/slots?property_id={property_id}&limit=500", headers=auth(admin)
        ),
        200,
        "list slots",
    )["items"]
    blocked = 0
    for slot in slots:
        if slot["code"].startswith("B-"):
            continue
        if slot["status"] != "AVAILABLE":
            continue
        expect(
            await client.patch(
                f"/parking/slots/{slot['id']}",
                headers=auth(admin),
                json={"status": "MAINTENANCE"},
            ),
            200,
            f"block non-benchmark slot {slot['code']}",
        )
        blocked += 1
    print(f"  isolation    {blocked} pre-existing bays blocked from this run")

    arrival = datetime.now(UTC) + timedelta(minutes=5)
    departure = arrival + timedelta(hours=2)
    approved: list[dict] = []
    for index in range(1, total_slots + 1):
        plate = f"KA99B{index:04d}"
        invitation = expect(
            await client.post(
                "/invitations",
                headers=auth(resident),
                json={
                    "visitor_name": f"Benchmark Visitor {index:03d}",
                    "vehicle_registration": plate,
                    "vehicle_category": "FOUR_WHEELER",
                    "visitor_type": "GUEST",
                    "purpose": "Write-path benchmark",
                    "expected_arrival": arrival.isoformat(),
                    "expected_departure": departure.isoformat(),
                },
            ),
            201,
            f"create invitation {index}",
        )
        approval = expect(
            await client.post(
                f"/invitations/{invitation['id']}/approve", headers=auth(resident)
            ),
            200,
            f"approve invitation {index}",
        )
        approved.append(
            {
                "invitation_id": invitation["id"],
                "pass_token": approval["pass_token"],
                "plate": plate,
                "slot_code": approval["parking_slot_code"],
            }
        )
        if index % 25 == 0:
            print(f"  approved     {index}/{total_slots}")

    # Free exactly the requested number of bays, leaving every other benchmark
    # bay reserved. The contention phase then has a deterministic ceiling.
    for entry in approved[: args.contention_free_slots]:
        expect(
            await client.post(
                f"/invitations/{entry['invitation_id']}/cancel",
                headers=auth(resident),
                json={"reason": "Benchmark contention fixture release"},
            ),
            200,
            "release contention fixture",
        )
    gate_entries = approved[args.contention_free_slots :]

    print("  setup        complete")
    return tokens, property_id, gate_entries, [row["pass_token"] for row in approved]


async def create_pending_visits(
    client: httpx.AsyncClient, resident: str, count: int, offset: int
) -> list[dict]:
    arrival = datetime.now(UTC) + timedelta(minutes=5)
    departure = arrival + timedelta(hours=2)
    created: list[dict] = []
    for index in range(count):
        number = offset + index
        plate = f"KA98C{number:04d}"
        invitation = expect(
            await client.post(
                "/invitations",
                headers=auth(resident),
                json={
                    "visitor_name": f"Contention Visitor {number:03d}",
                    "vehicle_registration": plate,
                    "vehicle_category": "FOUR_WHEELER",
                    "visitor_type": "GUEST",
                    "purpose": "Allocation contention benchmark",
                    "expected_arrival": arrival.isoformat(),
                    "expected_departure": departure.isoformat(),
                },
            ),
            201,
            f"create contention invitation {number}",
        )
        created.append({"id": invitation["id"], "plate": plate})
    return created


async def allocation_contention(
    client: httpx.AsyncClient,
    tokens: dict[str, str],
    args: argparse.Namespace,
) -> dict:
    rounds: list[dict] = []
    offsets = [0]
    for round_number in range(1, args.contention_rounds + 1):
        pending = await create_pending_visits(
            client,
            tokens["resident"],
            args.contention_attempts,
            offsets[-1],
        )
        offsets.append(offsets[-1] + args.contention_attempts)

        async def attempt(entry: dict, barrier: asyncio.Barrier) -> dict:
            began = time.perf_counter()
            try:
                await barrier.wait()
                response = await client.post(
                    f"/invitations/{entry['id']}/approve",
                    headers=auth(tokens["resident"]),
                )
                elapsed = (time.perf_counter() - began) * 1000
                if response.status_code == 200:
                    return {
                        "status": 200,
                        "outcome": "allocated",
                        "latency_ms": elapsed,
                        "invitation_id": entry["id"],
                        "slot_code": response.json().get("parking_slot_code"),
                    }
                if response.status_code == 409:
                    code = response.json().get("error", {}).get("code")
                    if code == "no_slot_available":
                        return {
                            "status": 409,
                            "outcome": "no_slot_available",
                            "latency_ms": elapsed,
                        }
                return {
                    "status": response.status_code,
                    "outcome": "unexpected",
                    "latency_ms": elapsed,
                    "detail": response.text[:300],
                }
            except Exception as exc:  # pragma: no cover - environment dependent
                return {
                    "status": 0,
                    "outcome": "unexpected",
                    "latency_ms": (time.perf_counter() - began) * 1000,
                    "detail": repr(exc),
                }

        barrier = asyncio.Barrier(args.contention_attempts)
        results = await asyncio.gather(
            *(attempt(entry, barrier) for entry in pending)
        )
        successes = [row for row in results if row["outcome"] == "allocated"]
        conflicts = [row for row in results if row["outcome"] == "no_slot_available"]

        for row in successes:
            cancel = await client.post(
                f"/invitations/{row['invitation_id']}/cancel",
                headers=auth(tokens["resident"]),
                json={"reason": "Free the contention bay for the next round"},
            )
            if cancel.status_code != 200:
                fail("cancel contention winner", cancel)

        rounds.append(
            {
                "round": round_number,
                "attempts": len(results),
                "allocated": len(successes),
                "no_slot_available": len(conflicts),
                "unexpected": len(results) - len(successes) - len(conflicts),
                "latency_ms": summarize([row["latency_ms"] for row in results]),
                "allocated_latency_ms": summarize(
                    [row["latency_ms"] for row in successes]
                ),
                "conflict_latency_ms": summarize(
                    [row["latency_ms"] for row in conflicts]
                ),
            }
        )
        print(
            f"  contention   round {round_number}: "
            f"{len(successes)} allocated · {len(conflicts)} no-slot · "
            f"{len(results) - len(successes) - len(conflicts)} unexpected"
        )

    flat = [row for entry in rounds for row in [entry]]
    all_latencies = [
        value
        for entry in rounds
        for value in [entry["latency_ms"]["p50_ms"]]
    ]
    return {
        "rounds": rounds,
        "attempts": sum(entry["attempts"] for entry in rounds),
        "allocated": sum(entry["allocated"] for entry in rounds),
        "no_slot_available": sum(entry["no_slot_available"] for entry in rounds),
        "unexpected": sum(entry["unexpected"] for entry in rounds),
        "expected_allocations": args.contention_rounds * args.contention_free_slots,
        "free_slots_per_round": args.contention_free_slots,
        "_latencies": all_latencies,
        "_flat": flat,
    }


async def gate_cycles(
    client: httpx.AsyncClient, tokens: dict[str, str], entries: list[dict], workers: int
) -> dict:
    queue: asyncio.Queue[dict] = asyncio.Queue()
    for entry in entries:
        queue.put_nowait(entry)

    step_latencies: dict[str, list[float]] = defaultdict(list)
    cycle_latencies: list[float] = []
    statuses: Counter[str] = Counter()
    errors: list[dict] = []
    lock = asyncio.Lock()

    async def worker() -> None:
        while True:
            try:
                entry = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            cycle_started = time.perf_counter()
            try:
                began = time.perf_counter()
                authorize = await client.post(
                    "/gate/entry/authorize",
                    headers=auth(tokens["guard"]),
                    json={"token": entry["pass_token"], "plate_number": entry["plate"]},
                )
                step_latencies["authorize"].append((time.perf_counter() - began) * 1000)
                statuses[f"authorize:{authorize.status_code}"] += 1
                if authorize.status_code != 200:
                    raise RuntimeError(f"authorize {authorize.status_code}: {authorize.text[:200]}")

                began = time.perf_counter()
                confirm = await client.post(
                    "/gate/entry/confirm",
                    headers=auth(tokens["guard"]),
                    json={"invitation_id": entry["invitation_id"]},
                )
                step_latencies["confirm"].append((time.perf_counter() - began) * 1000)
                statuses[f"confirm:{confirm.status_code}"] += 1
                if confirm.status_code != 200:
                    raise RuntimeError(f"confirm {confirm.status_code}: {confirm.text[:200]}")

                began = time.perf_counter()
                release = await client.post(
                    "/gate/exit/confirm",
                    headers=auth(tokens["guard"]),
                    json={"invitation_id": entry["invitation_id"]},
                )
                step_latencies["exit"].append((time.perf_counter() - began) * 1000)
                statuses[f"exit:{release.status_code}"] += 1
                if release.status_code != 200:
                    raise RuntimeError(f"exit {release.status_code}: {release.text[:200]}")

                cycle_latencies.append((time.perf_counter() - cycle_started) * 1000)
            except Exception as exc:
                async with lock:
                    errors.append({"invitation_id": entry["invitation_id"], "error": str(exc)})

    started = time.perf_counter()
    await asyncio.gather(*(worker() for _ in range(workers)))
    elapsed = time.perf_counter() - started

    return {
        "workers": workers,
        "cycles_completed": len(cycle_latencies),
        "cycles_expected": len(entries),
        "requests": sum(step_latencies.values(), []).__len__(),
        "errors": len(errors),
        "error_samples": errors[:5],
        "wall_seconds": round(elapsed, 3),
        "cycles_per_second": round(len(cycle_latencies) / elapsed, 2) if elapsed else 0,
        "cycle_latency_ms": summarize(cycle_latencies),
        "per_step": {name: summarize(values) for name, values in step_latencies.items()},
        "status_counts": dict(sorted(statuses.items())),
    }


def database_invariants() -> dict:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        return {"error": "DATABASE_URL is not set; invariants not checked"}
    try:
        import psycopg
    except ImportError:
        return {"error": "psycopg is not installed; invariants not checked"}

    dsn = dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    try:
        with psycopg.connect(dsn, connect_timeout=5) as connection:
            def scalar(sql: str) -> int:
                row = connection.execute(sql).fetchone()
                return int(row[0]) if row else 0

            events = dict(
                connection.execute(
                    "SELECT decision, count(*) FROM entry_exit_events GROUP BY decision"
                ).fetchall()
            )
            return {
                "active_reservations": scalar(
                    "SELECT count(*) FROM parking_reservations WHERE status = 'ACTIVE'"
                ),
                "active_occupancies": scalar(
                    "SELECT count(*) FROM parking_occupancies WHERE status = 'ACTIVE'"
                ),
                "duplicate_active_reservations": scalar(
                    """
                    SELECT count(*) FROM (
                        SELECT slot_id FROM parking_reservations
                        WHERE status = 'ACTIVE' GROUP BY slot_id HAVING count(*) > 1
                    ) duplicates
                    """
                ),
                "duplicate_active_occupancies": scalar(
                    """
                    SELECT count(*) FROM (
                        SELECT slot_id FROM parking_occupancies
                        WHERE status = 'ACTIVE' GROUP BY slot_id HAVING count(*) > 1
                    ) duplicates
                    """
                ),
                "completed_invitations": scalar(
                    "SELECT count(*) FROM invitations WHERE status = 'COMPLETED'"
                ),
                "offline_ledger_rows": scalar("SELECT count(*) FROM offline_gate_actions"),
                "event_decisions": {key: int(value) for key, value in events.items()},
            }
    except Exception as exc:  # pragma: no cover - environment dependent
        return {"error": f"invariant query failed: {exc!r}"}


async def run(args: argparse.Namespace) -> dict:
    started_at = time.time()
    limits = httpx.Limits(
        max_connections=max(args.gate_workers, args.contention_attempts) + 8,
        max_keepalive_connections=max(args.gate_workers, args.contention_attempts) + 8,
    )
    async with httpx.AsyncClient(
        base_url=args.base_url, timeout=60.0, limits=limits
    ) as client:
        print("ParkVanta write-path benchmark")
        print(f"  target       {args.base_url}")
        setup_started = time.perf_counter()
        tokens, property_id, gate_entries, _all_tokens = await setup(client, args)
        setup_seconds = time.perf_counter() - setup_started
        print(f"  setup time   {setup_seconds:.2f}s")

        contention = await allocation_contention(client, tokens, args)
        gates = await gate_cycles(
            client, tokens, gate_entries, args.gate_workers
        )

    invariants = database_invariants()
    elapsed = time.time() - started_at
    contention.pop("_latencies", None)
    contention.pop("_flat", None)

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
            "fixture_slots": args.gate_cycles + args.contention_free_slots,
            "gate_cycles": args.gate_cycles,
            "gate_workers": args.gate_workers,
            "contention_rounds": args.contention_rounds,
            "contention_attempts_per_round": args.contention_attempts,
            "contention_free_slots": args.contention_free_slots,
            "property_id": str(property_id),
            "setup_seconds": round(setup_seconds, 3),
            "elapsed_seconds": round(elapsed, 3),
        },
        "phases": {
            "allocation_contention": contention,
            "gate_cycle": gates,
        },
        "invariants": invariants,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="ParkVanta write-path benchmark")
    parser.add_argument("--base-url", default="http://127.0.0.1:8093/api/v1")
    parser.add_argument("--admin-email", default="admin@skyline.dev")
    parser.add_argument("--resident-email", default="resident@skyline.dev")
    parser.add_argument("--guard-email", default="guard@skyline.dev")
    parser.add_argument("--password", default="ParkVanta@2026")
    parser.add_argument("--gate-cycles", type=int, default=100)
    parser.add_argument("--gate-workers", type=int, default=16)
    parser.add_argument("--contention-rounds", type=int, default=3)
    parser.add_argument("--contention-attempts", type=int, default=30)
    parser.add_argument("--contention-free-slots", type=int, default=6)
    parser.add_argument("--output", default="docs/benchmarks/write-local.json")
    args = parser.parse_args()

    result = asyncio.run(run(args))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    gates = result["phases"]["gate_cycle"]
    contention = result["phases"]["allocation_contention"]
    print("\nResults")
    print(
        f"  gate cycles  {gates['cycles_completed']}/{gates['cycles_expected']} · "
        f"{gates['requests']} requests · {gates['errors']} errors · "
        f"{gates['cycles_per_second']} cycles/s"
    )
    print(
        f"  gate p95     cycle {gates['cycle_latency_ms']['p95_ms']}ms · "
        f"authorize {gates['per_step'].get('authorize', {}).get('p95_ms')}ms · "
        f"confirm {gates['per_step'].get('confirm', {}).get('p95_ms')}ms · "
        f"exit {gates['per_step'].get('exit', {}).get('p95_ms')}ms"
    )
    print(
        f"  contention   {contention['allocated']} allocated · "
        f"{contention['no_slot_available']} no-slot · "
        f"{contention['unexpected']} unexpected"
    )
    print(f"  invariants   {result['invariants']}")
    print(f"  written      {output}")


if __name__ == "__main__":
    main()
