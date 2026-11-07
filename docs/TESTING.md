# ParkVanta — Testing

## 1. Summary of the current run

| Suite | Command | Result |
| :--- | :--- | :--- |
| Backend | `cd backend && ../.venv/bin/pytest -q` | **28 passed** |
| Frontend unit | `cd apps/web && npm test` | **5 passed** |
| Frontend production build | `cd apps/web && npm run build` | **Passed** (tsc + Vite) |
| Browser E2E | `cd apps/web && npm run test:e2e` | **1 passed** (real Chrome, offline transition) |
| Load benchmark | `make load-test` | **3,912 requests · 195.06 req/s · 0 errors** |
| Migration | `alembic upgrade head` | Applied to PostgreSQL 16, 23 tables |

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

## 2. What the backend suite proves

**Authentication and tenancy** (`test_auth.py`)
- Login returns tokens and identity; wrong password yields 401.
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
- The property Redis Stream retains the frame, and a stream opened with `last_event_id=0-0` replays the
  approval event with its Stream id — the basis for reconnect recovery.

**Offline reconciliation** (`test_offline.py`)
- An offline exit releases the occupancy once; replaying the same client event is reported as a duplicate and
  produces no second release or audit row.
- An offline entry confirmation without a prior online authorization is rejected with `authorization_required`,
  and the reserved slot stays reserved.
- An offline entry confirmation after an online authorization succeeds.
- A device timestamp one hour in the future is rejected with `clock_mismatch`.
- A cross-tenant reconciliation request returns 403.

## 2.1 Browser E2E

`apps/web/e2e/visitor-flow.spec.ts` runs in a real Chrome instance via `channel: "chrome"`. Playwright starts
`scripts/e2e-api.sh`, which drops and recreates `parkvanta_e2e`, applies all migrations, loads the demo seed and
serves the API on `127.0.0.1:8091`; Vite runs on `127.0.0.1:5173` with `VITE_API_BASE_URL` pointed at it.

The test performs the acceptance scenario without touching the database:

1. Resident signs in, creates a vehicle-backed invitation and approves it.
2. The issued pass URL is opened in a separate browser context; the QR renders in the visitor view.
3. Guard signs in, pastes the pass, verifies, authorizes entry and confirms the vehicle entered.
4. The slot is reported `OCCUPIED`; the vehicle appears inside.
5. Guard goes offline: entry verification locks and the exit is queued in browser storage.
6. The vehicle leaves the displayed list optimistically; reconnecting reconciles the queue exactly once.
7. Society admin signs in and the overview renders capacity.

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

## 5. Not yet automated

| Area | Status |
| :--- | :--- |
| Mixed write-path load | Read-path benchmark exists; contended allocation storms are not measured |
| Dependency CVE gate | Planned (`pip-audit`, `npm audit --omit=dev`) |
| Vision accuracy suite | Blocked on Stage 13 |
| Long-disconnect replay (>500 frames) | Bounded Stream retention; older frames are reconciled by REST refetch |

## 6. Test data policy

Tests create their own tenants and truncate tables between cases. The development seed is the only demo data and
is clearly separated from test fixtures. No fake metrics are exposed in production views.
