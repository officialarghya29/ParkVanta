# ParkVanta — System Architecture

## 1. Shape

A **modular monolith** with a future-facing, isolated inference service. One deployable API, one responsive web
client, PostgreSQL as the authority, Redis for advisory state.

```mermaid
flowchart LR
    subgraph Client["React · TypeScript · Vite PWA"]
        R[Resident]
        G[Guard console]
        V[Visitor pass]
        A[Admin]
    end

    subgraph API["FastAPI modular monolith"]
        AUTH[auth · RBAC · tenancy]
        INV[invitations]
        QRE[QR engine]
        PARK[parking engine]
        GATE[gate operations]
        AN[analytics]
        N[notifications]
    end

    PG[(PostgreSQL 16)]
    RD[(Redis)]
    W[Expiry worker]
    VIS[Vision service · optional]

    Client -->|HTTPS /api/v1| API
    API --> PG
    API -. rate limit .-> RD
    W --> PG
    GATE -. advisory .-> VIS
```

## 2. Layering

```text
routers (HTTP, roles, status codes)
  → services (business rules, transactions, audit)
    → repositories / SQLAlchemy Core & ORM queries
      → PostgreSQL
```

- Routers never compose multi-step transactions; services own commit boundaries.
- Tenant checks occur in the service layer through `assert_org_access` / `assert_property_access`.
- Audit rows are written inside the same transaction as the operation they describe.

## 3. Critical flows

### 3.1 Invitation approval with allocation

```text
BEGIN
  lock invitation row
  validate owner / state / policy
  SELECT slot … FOR UPDATE SKIP LOCKED   -- one compatible free slot
  UPDATE slot → RESERVED
  INSERT reservation (ACTIVE)            -- partial unique index backstop
  INSERT qr_pass (SHA-256 of 256-bit token)
  UPDATE invitation → APPROVED
  INSERT audit
COMMIT
```

If no slot is available the transaction rolls back and the invitation stays `PENDING`. Approval never creates a
false promise of parking.

### 3.2 Entry authorization

```text
verify pass (8 ordered gates, read-only)
  → if denied: write DENIED event + audit, return 403/409
  → if allowed:
      UPDATE qr_pass SET status = CONSUMED WHERE status = ACTIVE   -- atomic
      INSERT entry_exit_event (AUTHORIZED)
      INSERT audit
COMMIT
```

Entry confirmation is a separate step: it converts the reservation into an occupancy and flips the slot to
`OCCUPIED`. Authorization is therefore never mistaken for physical presence.

### 3.3 Exit

```text
lock occupancy (ACTIVE)
  → occupancy RELEASED, slot AVAILABLE, reservation RELEASED, invitation COMPLETED
  → EXIT event + audit + resident notification
```

Repeated exits return `409 already_exited` rather than silently succeeding.

## 4. Data ownership and isolation

- Every scoped table carries `organization_id`; parking, invitations and events also carry `property_id`.
- Residents read only their own invitations.
- Guards read only their assigned property.
- Society admins read their organization; super admins may cross organizations deliberately.
- Analytics queries always require a resolved property.

## 5. State machines

**Slot:** `AVAILABLE → RESERVED → OCCUPIED → AVAILABLE`, with `BLOCKED` and `MAINTENANCE` as administrative
states. Reserved is never treated as occupied.

**Invitation:** `PENDING → APPROVED → COMPLETED`; terminal alternatives `REJECTED`, `CANCELLED`, `EXPIRED`.

**Pass:** `ACTIVE → CONSUMED | REVOKED | EXPIRED`.

## 6. Deployment topology

```text
Nginx / managed ingress (TLS)
   ├── static SPA (apps/web build)
   └── /api → uvicorn (FastAPI, N workers)
                 ├── PostgreSQL (managed, backups, PITR)
                 ├── Redis (rate limits, future fan-out)
                 └── worker timer (python -m app.workers.expiry)
```

## 7. Deliberate trade-offs

| Decision | Trade-off |
| :--- | :--- |
| Modular monolith | Simpler transactions and ops; no independent scaling per domain yet |
| Bearer access token in browser memory + httpOnly refresh cookie | Refresh is XSS-resistant; access token lifetime is 15 minutes |
| Polling (15–20s) instead of WebSockets | Simpler failure model; realtime is a planned enhancement |
| Slot chosen at approval, not at arrival | Guarantees a destination; may hold a slot for a no-show until expiry |
| Pass issued at approval | Removes the "awaiting approval" scan state; the resident must approve before a pass exists |
| External notifications recorded as `SKIPPED` until a provider is configured | No fake delivery claims |
