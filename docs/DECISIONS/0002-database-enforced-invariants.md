# ADR 0002 — Enforce parking invariants in PostgreSQL

**Status:** Accepted · **Date:** 2026-11-08

## Context

Application-level "check then insert" logic fails under concurrency: two guards can allocate the same slot or
consume the same pass within milliseconds. Frontend checks provide no guarantee at all.

## Decision

1. Allocate with `SELECT … FOR UPDATE OF parking_slots SKIP LOCKED` inside the approval transaction.
2. Add partial unique indexes:
   - `uq_active_reservation_slot` on `(slot_id) WHERE status = 'ACTIVE'`
   - `uq_active_occupancy_slot` on `(slot_id) WHERE status = 'ACTIVE'`
3. Consume a QR pass with a conditional update on `status = 'ACTIVE'`.

## Consequences

- Concurrent duplicate allocations and replays fail at the database, not in a race window.
- SQLite cannot reproduce these semantics, so the test suite runs on PostgreSQL.
- A failed allocation rolls back the whole approval, leaving the invitation pending instead of falsely approved.
- Write throughput is bounded by PostgreSQL row locking, which is acceptable at residential scale.
