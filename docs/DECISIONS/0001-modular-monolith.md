# ADR 0001 — Modular monolith over microservices

**Status:** Accepted · **Date:** 2026-11-08

## Context

ParkVanta's critical operations (approval → allocation → pass issuance → entry) must be transactionally consistent.
Splitting these across services would require distributed transactions or sagas before the product has a single
pilot property. The team is small and the operational surface must stay minimal.

## Decision

Build the core as one FastAPI application with explicit domain modules (`auth`, `tenancy`, `invitations`, `qr`,
`parking`, `gate`, `analytics`) and a single PostgreSQL database. Keep the optional vision inference service
separate because its runtime, dependencies and failure profile differ.

## Consequences

- Multi-table invariants are enforced in one transaction.
- One deployable, one migration stream, one set of logs.
- Domain boundaries are code-level (services and schemas), not network-level; discipline is required to prevent
  coupling.
- Scaling is vertical first, then read replicas or extraction of analytics if needed.
