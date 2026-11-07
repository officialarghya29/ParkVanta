# ParkVanta — Software Requirements Specification

## 1. Functional requirements

### FR-1 Identity and access
- FR-1.1 Residents self-register against a property and apartment; accounts start unverified.
- FR-1.2 Administrators provision staff accounts (admin, manager, guard) and resident accounts.
- FR-1.3 Authentication uses email + password (Argon2id) and short-lived JWT access tokens.
- FR-1.4 Refresh tokens are opaque, hashed at rest, rotated on use, and family-revoked on replay.
- FR-1.5 Suspended or inactive accounts cannot authenticate or use existing tokens.
- FR-1.6 Login attempts are rate limited per email and client IP.

### FR-2 Tenancy
- FR-2.1 Every scoped entity carries `organization_id` and, where relevant, `property_id`.
- FR-2.2 Reads and writes are filtered at the query and service boundary.
- FR-2.3 A user assigned to a property cannot access another property's operational data.
- FR-2.4 Cross-tenant attempts return `403`, never data.

### FR-3 Visitors and invitations
- FR-3.1 Residents create invitations with visitor name, optional phone, optional vehicle, visitor type,
  purpose, arrival and departure.
- FR-3.2 Invitations cannot start in the past, cannot exceed 72 hours, and are capped at 30 days ahead.
- FR-3.3 Residents approve, reject or cancel their own invitations; staff may act on property invitations.
- FR-3.4 Approval reserves one compatible slot when a vehicle is attached, and issues one QR pass.
- FR-3.5 Cancellation revokes the pass and releases the reservation.

### FR-4 QR pass
- FR-4.1 Tokens are generated with 256 bits of CSPRNG entropy.
- FR-4.2 Only the SHA-256 hash is stored; the raw token is returned exactly once.
- FR-4.3 The pass expires at `min(expected_departure, expected_arrival + policy validity)`.
- FR-4.4 Verification checks: existence, society/property match, revocation, prior use, expiry,
  arrival grace, invitation state, vehicle match, visitor window, active reservation.
- FR-4.5 Consumption is atomic; concurrent scans yield exactly one success.
- FR-4.6 The visitor-facing QR encodes the pass URL, which contains no PII.

### FR-5 Parking
- FR-5.1 Slots have a category (visitor, resident, reserved, temporary, service, emergency, accessible),
  a vehicle compatibility class and a status.
- FR-5.2 Allocation selects the highest-priority compatible free slot in the property using row locking.
- FR-5.3 A slot may hold at most one active reservation and one active occupancy (partial unique indexes).
- FR-5.4 A reservation becomes an occupancy only after the guard confirms entry.
- FR-5.5 Exit releases the occupancy, marks the reservation released, completes the invitation and frees the slot.
- FR-5.6 Expired reservations free their slot; pending invitations past their window expire.

### FR-6 Gate operations
- FR-6.1 Verify returns an explicit reason code for every outcome.
- FR-6.2 Authorization is separate from physical gate opening.
- FR-6.3 Manual override requires a reason of at least 10 characters and is audited.
- FR-6.4 Denied authorizations are recorded as denied events.

### FR-7 Analytics
- FR-7.1 Metrics are computed from PostgreSQL, scoped by property.
- FR-7.2 Trends cover 1–90 days.
- FR-7.3 No visitor contact details appear in aggregate reporting.

## 2. Non-functional requirements

| ID | Requirement | Implementation |
| :--- | :--- | :--- |
| NFR-1 | Passwords never stored in plaintext | Argon2id (time 3, memory 64 MiB, parallelism 4) |
| NFR-2 | Tenant isolation | Query scoping + service assertions + tests |
| NFR-3 | Concurrency safety | Row locks, `SKIP LOCKED`, partial unique indexes |
| NFR-4 | Availability under AI failure | AI is isolated and optional; core path never calls it |
| NFR-5 | Responsive mobile layouts | Tailwind breakpoints; camera scanning on mobile browsers |
| NFR-6 | Observability | Structured logs, audit table, health and readiness probes |
| NFR-7 | Reproducible deployment | Pinned dependencies, Docker Compose, Alembic migrations |
| NFR-8 | Data protection | Minimum collection, hashed tokens, no PII in QR, audit retention |

## 3. Error semantics

All errors use a consistent envelope:

```json
{ "error": { "code": "already_used", "message": "This pass has already been used for entry.", "details": null } }
```

| HTTP | Meaning |
| :--- | :--- |
| 401 | Missing, expired or invalid credentials / refresh replay |
| 403 | Role, tenant or gate-policy denial |
| 404 | Resource not found or not visible to this tenant |
| 409 | State conflict (`already_used`, `already_exited`, `no_slot_available`, `already_approved`) |
| 422 | Validation failure |
| 429 | Rate limited |
| 503 | Dependency unavailable |

## 4. Assumptions

- One QR pass is issued per invitation; the raw token is delivered through an authorized channel by the client UI.
- A guard's session is scoped to a property; society administrators may operate across the organization.
- Visitor parking is a finite, pre-registered inventory managed by the society.
