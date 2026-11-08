# ParkVanta — Testing

## 1. Summary of the current run

| Suite | Command | Result |
| :--- | :--- | :--- |
| Backend | `cd backend && ../.venv/bin/pytest -q` | **46 passed** |
| Frontend unit | `cd apps/web && npm test` | **5 passed** |
| Frontend production build | `cd apps/web && npm run build` | **Passed** (tsc + Vite) |
| Browser E2E | `cd apps/web && npm run test:e2e` | **1 passed** (real Chrome, offline transition) |
| Read benchmark | `make load-test` | **3,912 requests · 195.06 req/s · 0 errors** |
| Write benchmark | `make load-test-write` | **100 cycles · 18/18 allocations · 0 errors** |
| Lint | `make lint` | **Ruff clean** |
| Dependency audits | `make audit` | **0 Python · 0 Node advisories** |
| Migration | `alembic upgrade head` | Applied to PostgreSQL 16, 25 tables · 5 migrations |
| Release gates | CI: bundle budget + Docker image builds | **JS/CSS gzip within budget · images under 450/120 MiB** |
| Worker health | `make worker-health` | **Exit 1 on stale queue or missing heartbeat** |

Backend tests run against a real PostgreSQL database (`parkvanta_test`), not SQLite, so row locking and partial
unique indexes are exercised with production semantics.

## 1.1 Recorded load run

`make load-test` boots an isolated `parkvanta_bench` database, seeds it, and drives authenticated reads for 20
seconds at 20-way concurrency. The raw JSON is [`benchmarks/local-20c.json`](benchmarks/local-20c.json).

| Metric | Recorded |
| :--- | ---: |
| Requests / throughput | 3,912 / 195.06 req/s |
| Errors | 0 |
| p50 / p95 / p99 | 90.66 / 168.51 / 236.39 ms |
| Max observed | 321.93 ms |

Environment: AMD Ryzen 7 8840HS, 16 threads, Linux x86_64, Python 3.12.3, PostgreSQL 16 and Redis 7 in Docker.
This is a read-path baseline on one host, not a capacity guarantee.

## 1.2 Recorded write run

`make load-test-write` uses a fresh `parkvanta_bench_write` database. It creates 106 visitor bays, blocks the 17
seed bays, approves 106 visits, frees six bays for a three-round contention test, then runs 100 full gate cycles
with 16 workers. Raw JSON: [`benchmarks/write-local.json`](benchmarks/write-local.json).

| Metric | Recorded |
| :--- | ---: |
| Gate cycles / requests / errors | 100 / 300 / 0 |
| Gate throughput | 28.09 cycles/s |
| Cycle p50 / p95 / p99 | 544.88 / 729.20 / 745.45 ms |
| Authorize / confirm / exit p95 | 348.14 / 221.72 / 231.95 ms |
| Contention attempts | 90 (3 × 30) |
| Allocations / expected | 18 / 18 |
| `no_slot_available` / unexpected | 72 / 0 |
| Duplicate active reservations / occupancies | 0 / 0 |
| Active reservations / occupancies afterwards | 0 / 0 |

The run also asserts 100 `AUTHORIZED`, 100 `CONFIRMED` and 100 `RELEASED` events. The fixture is synthetic and
single-host; it proves the locking and lifecycle paths, not a specific society's capacity.

## 1.3 Static and dependency gates

- `make lint` → Ruff passes over the backend.
- `make audit` → `pip-audit` and `npm audit --omit=dev --audit-level=high` pass with zero advisories.
- Full `npm audit` is also clean after the Playwright 1.65 and Vitest 5 upgrades.
- Bandit high-severity scan is clean.
- CI runs all of the above in the `security` job; failures block the workflow.

## 2. What the backend suite proves

**Authentication and tenancy** (`test_auth.py`)
- Login returns tokens and identity; wrong password yields 401.
- Password reset sends a real single-use link through the mail adapter, rotates the password and revokes old
  sessions; unknown emails return the same 202 without sending.
- Refresh rotation works; reusing an old refresh token revokes the whole session family.
- Suspended accounts cannot sign in.
- Cross-organization property reads return 403.
- Guards cannot read another property's inventory.
- Login writes an audit row.

**Visitor lifecycle** (`test_invitation_flow.py`)
- Full flow: create → approve (slot assigned) → public pass view → verify → authorize → confirm entry
  (slot `OCCUPIED`) → exit (slot `AVAILABLE`, invitation `COMPLETED`).
- Duplicate authorization returns `409 already_used` with exactly one audit trail.
- Plate mismatch denies both verification and authorization.
- Cancellation revokes the pass, releases the reservation and returns the slot.
- No free slot blocks approval and leaves the invitation `PENDING`.
- A resident cannot approve another resident's invitation.
- Residents only list their own invitations; guards see the property's invitations.
- Manual override rejects short reasons and records an audit event.
- Entry confirmation is rejected with `authorization_required` until an online authorization event exists, so an
  occupancy cannot be created by calling confirm directly.

**Onboarding, notifications and bootstrap** (`test_bootstrap.py`, `test_onboarding.py`, `test_notifications.py`)
- Bootstrap creates exactly one organization, property, default policy and society admin; duplicate slug or email
  is refused.
- A 16-character property join code resolves only apartment labels, registers a resident as unverified, and is
  invalidated when rotated.
- Join-code retrieval is admin-only; guards receive 403.
- Notifications are scoped to their owner, unread counts change on read, `read-all` clears the inbox, and another
  resident cannot mark someone else's notification.

**Concurrency** (`test_concurrency.py`)
- Two threads authorize the same pass simultaneously: outcomes are exactly `authorized` + `already_used`;
  one pass row is `CONSUMED`; one `ENTRY/AUTHORIZED` event exists.
- Two threads allocate two vehicles against a single free slot: exactly one reservation exists; the other thread
  receives `no_slot_available`.

Both tests use a thread barrier and independent SQLAlchemy sessions against PostgreSQL.

**Realtime** (`test_realtime.py`)
- Stream ticket minting requires authentication and property access; a cross-tenant request returns 403.
- An invalid ticket is rejected before the stream opens.
- The stream returns `text/event-stream` and emits the `: connected` frame.
- Approving an invitation publishes `invitation.approved` on the property's Redis channel with the matching
  invitation id, proving the service-layer hooks fire after commit.
- The property Redis Stream retains the frame, and a stream opened with `last_event_id=0` replays the approval
  from the PostgreSQL archive with its sequence id.
- 505 archived events remain replayable after the Redis 500-frame window, proving durable reconnect recovery.

**Notification outbox** (`test_notification_delivery.py`)
- A queued email is delivered over a real local SMTP server, marked `SENT`, and not sent twice.
- SMTP failure increments attempts and schedules an exponential retry without losing the in-app note.
- Missing SMTP marks the delivery `SKIPPED` rather than falsely claiming success.

**Worker health and metrics** (`test_workers.py`)
- The expiry sweep deletes archived events past `EVENT_RETENTION_DAYS` and keeps newer frames.
- An overstay is flagged once and queues both an in-app note and a pending email.
- The health command fails on a stale outbox, then passes after the worker marks mail `SKIPPED`.
- `/metrics` exposes outbox counts and worker age/up, and enforces the configured bearer token.
- Two overlapping worker sessions upsert exactly one heartbeat row without a unique-key violation.

**Offline reconciliation** (`test_offline.py`)
- An offline exit releases the occupancy once; replaying the same client event is reported as a duplicate and
  produces no second release or audit row.
- An offline entry confirmation without a prior online authorization is rejected with `authorization_required`,
  and the reserved slot stays reserved.
- An offline entry confirmation after an online authorization succeeds.
- A device timestamp one hour in the future is rejected with `clock_mismatch`.
- A cross-tenant reconciliation request returns 403.
- A society-wide admin with no assigned property can reconcile an exit using the request's explicit property id.

## 2.1 Browser E2E

`apps/web/e2e/visitor-flow.spec.ts` runs in a real Chrome instance via `channel: "chrome"`. Playwright starts
`scripts/e2e-api.sh`, which drops and recreates `parkvanta_e2e`, applies all migrations, loads the demo seed and
serves the API on `127.0.0.1:8091`; Vite runs on `127.0.0.1:5173` with `VITE_API_BASE_URL` pointed at it.

The test performs the acceptance scenario without touching the database:

1. Resident signs in, creates a vehicle-backed invitation and approves it.
2. The issued pass URL is opened in a separate browser context; the QR renders in the visitor view.
3. Guard signs in, pastes the pass, verifies, authorizes entry and confirms the vehicle entered.
4. The slot is reported `OCCUPIED`; the vehicle appears inside.
5. Guard goes offline: entry verification locks and the exit is queued in IndexedDB.
6. The vehicle leaves the displayed list optimistically; reconnecting reconciles the queue exactly once.
7. The browser reloads the resident session and restores it from the httpOnly refresh cookie; no access token
   is present in localStorage.
8. Society admin signs in and the overview renders capacity.

To run in CI without Google Chrome, install browsers and set `PLAYWRIGHT_CHANNEL=chromium`.

## 3. Frontend tests

- Pass-token extraction from raw tokens, visitor URLs, query strings and fragments.
- Enum-to-label formatting.
- `datetime-local` conversion.

The production build type-checks the entire client (`tsc --noEmit`).

## 4. Manual acceptance script

1. `make up && make migrate && make seed`
2. `make api` (port 8080) and `make web` (port 5173).
3. Sign in as `resident@skyline.dev` / `ParkVanta@2026`.
4. Create an invitation with a vehicle, approve it, open the QR panel.
5. Sign in as `guard@skyline.dev` in a second browser profile.
6. Scan/paste the pass, verify, authorize, confirm entry.
7. Confirm the admin dashboard shows an occupied slot and one vehicle inside.
8. Confirm exit; the slot returns to `AVAILABLE` and the invitation becomes `COMPLETED`.
9. Attempt a second authorization with the same token; expect `already_used`.
10. Sign in as `admin@skyline.dev`, open **Inventory**, copy the join code and open `/register` in a private
    window. Register with an apartment; confirm the account appears as **Pending**, then **Verify** it.

## 5. Not yet automated

| Area | Status |
| :--- | :--- |
| Vision accuracy suite | Blocked on Stage 13 |
| Live SMTP relay | A worker test delivers through a local SMTP server; failure paths inject relay errors. The pilot relay must be configured and tested |
| SMS / WhatsApp delivery | Email and in-app delivery are implemented; SMS/WhatsApp providers are not |

## 6. Test data policy

Tests create their own tenants and truncate tables between cases. The development seed is the only demo data and
is clearly separated from test fixtures. No fake metrics are exposed in production views.
