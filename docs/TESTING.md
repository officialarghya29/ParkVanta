# ParkVanta — Testing

## 1. Summary of the current run

| Suite | Command | Result |
| :--- | :--- | :--- |
| Backend | `cd backend && ../.venv/bin/pytest -q` | **17 passed** |
| Frontend unit | `cd apps/web && npm test` | **5 passed** |
| Frontend production build | `cd apps/web && npm run build` | **Passed** (tsc + Vite) |
| Migration | `alembic upgrade head` | Applied to PostgreSQL 16, 22 tables |

Backend tests run against a real PostgreSQL database (`parkvanta_test`), not SQLite, so row locking and partial
unique indexes are exercised with production semantics.

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
| Playwright browser E2E | Planned (Stage 15) |
| Load/soak testing | Planned — target: 50 concurrent gates per property |
| Dependency CVE gate | Planned (`pip-audit`, `npm audit --omit=dev`) |
| Vision accuracy suite | Blocked on Stage 13 |
| Offline queue reconciliation | Not implemented; requires design sign-off |

## 6. Test data policy

Tests create their own tenants and truncate tables between cases. The development seed is the only demo data and
is clearly separated from test fixtures. No fake metrics are exposed in production views.
