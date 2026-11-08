# ParkVanta — API Specification

Base path `/api/v1`. OpenAPI is served at `/api/v1/openapi.json`, interactive docs at `/docs`.

Authentication: `Authorization: Bearer <access_token>`. The refresh token is set as an httpOnly cookie
(`parkvanta_refresh`, path `/api/v1/auth`) and is also returned once at login for non-browser clients.

## Error envelope

```json
{ "error": { "code": "no_slot_available", "message": "No compatible parking slot is currently available.", "details": null } }
```

## Authentication

| Method | Path | Auth | Notes |
| :--- | :--- | :--- | :--- |
| POST | `/auth/register` | public | Resident self-registration; account starts unverified |
| POST | `/auth/login` | public | Rate limited; returns access + refresh tokens |
| POST | `/auth/refresh` | cookie/body | Rotates the refresh token; replay revokes the family |
| POST | `/auth/logout` | any | Revokes the presented refresh token |
| GET | `/auth/me` | bearer | Current identity |
| POST | `/auth/users` | admin | Provision staff/resident accounts |
| POST | `/auth/forgot-password` | public | Generic 202; delivers an SMTP link when configured |
| POST | `/auth/reset-password` | public | Consumes a reset token, revokes sessions |

## Public onboarding

| Method | Path | Auth | Notes |
| :--- | :--- | :--- | :--- |
| GET | `/public/join/{join_code}` | public | Property name/address and apartment labels for a valid code |
| POST | `/auth/register` | public | Creates an unverified resident for a returned property/apartment id |

## Society, property and inventory

| Method | Path | Roles |
| :--- | :--- | :--- |
| POST/GET | `/organizations` | super admin (create), all (scoped read) |
| POST/GET | `/properties` | admin, manager |
| GET | `/properties/{id}` | scoped |
| GET/POST | `/properties/{id}/join-code`, `/join-code/rotate` | admin, manager |
| POST/GET | `/properties/{id}/towers` | admin, manager |
| POST | `/apartments` | admin, manager |
| GET | `/properties/{id}/apartments` | scoped |
| POST/GET | `/properties/{id}/residents` | admin, manager |
| GET/PATCH | `/residents/me`, `/residents/{user_id}` | resident / admin |
| POST/GET | `/properties/{id}/guards` | admin, manager |
| POST/GET | `/parking/zones` | admin / scoped |
| POST/GET | `/parking/slots` | admin / scoped |
| PATCH | `/parking/slots/{slot_id}` | admin, manager |
| GET/PATCH | `/properties/{id}/policy` | scoped / admin |

## Visitors and invitations

| Method | Path | Roles |
| :--- | :--- | :--- |
| POST | `/invitations` | resident (verified) |
| GET | `/invitations?status=&search=&limit=&offset=` | scoped (residents see their own) |
| GET | `/invitations/{id}` | owner or staff |
| POST | `/invitations/{id}/approve` | owner or staff — returns the raw pass token once |
| POST | `/invitations/{id}/reject` | owner or staff |
| POST | `/invitations/{id}/cancel` | owner or staff |

## QR passes

| Method | Path | Roles |
| :--- | :--- | :--- |
| POST | `/qr/verify` | guard/admin — returns an explicit verdict |
| GET | `/qr/pass/{token}` | public — visitor-safe projection, no PII |
| GET | `/qr/{pass_id}/status` | staff |
| POST | `/qr/revoke` | owner/admin |

## Parking

| Method | Path | Roles |
| :--- | :--- | :--- |
| GET | `/parking/availability?property_id=` | scoped |
| POST | `/parking/allocate` | staff — idempotent per invitation |
| GET | `/parking/reservations` | staff |
| GET | `/parking/occupancies` | staff |
| POST | `/parking/occupancies/{id}/release` | staff |
| GET | `/parking/slots/available` | staff |

## Gate

| Method | Path | Behaviour |
| :--- | :--- | :--- |
| POST | `/gate/entry/authorize` | Verifies + consumes the pass atomically; 409 on duplicate |
| POST | `/gate/entry/confirm` | Requires a prior online `AUTHORIZED` event; creates occupancy, slot → `OCCUPIED` |
| POST | `/gate/exit/confirm` | Releases occupancy and slot; 409 if already exited |
| POST | `/gate/manual-override` | Reason ≥ 10 chars, audited |
| POST | `/gate/offline/reconcile` | Idempotent batch of queued exits/overrides/authorized entry confirmations |
| GET | `/gate/active-visitors` | Vehicles currently inside |
| GET | `/gate/recent-activity` | Last gate decisions |

## Realtime (Server-Sent Events)

`EventSource` cannot attach an `Authorization` header, so clients exchange their bearer token for a
short-lived, property-scoped stream ticket. Events are advisory: clients refetch REST state on receipt and on
reconnect; the database remains authoritative.

| Method | Path | Roles | Notes |
| :--- | :--- | :--- | :--- |
| POST | `/events/ticket` | any scoped user | Body `{ "property_id": "<uuid>" }`; returns `{ ticket, expires_in }` (2 minutes) |
| GET | `/events/stream?ticket=&last_event_id=` | ticket holder | `text/event-stream`; accepts `Last-Event-ID` header too |

Event types: `invitation.created`, `invitation.approved`, `invitation.rejected`, `invitation.cancelled`,
`gate.entry_authorized`, `gate.entry_confirmed`, `gate.exit_confirmed`, `gate.manual_override`,
`gate.entry_denied`, `parking.updated`, `parking.overstay`. Frames carry `id`, `type`, `property_id`,
`occurred_at` and a small `data` object (ids and slot codes, never visitor PII).

Every event is first stored in the `realtime_events` archive (PostgreSQL, 30-day default retention), then
appended to the Redis Stream `pv:stream:<property_id>` (bounded to 500 live frames) and published on
`pv:events:<property_id>`. Frame ids are archive sequence numbers. Passing `last_event_id` replays archived
events after that sequence, then tails Redis. Without Redis, live frames still flow through the in-process broker;
the archive remains the replay source. Events are advisory: clients refetch REST after receipt and reconnect.

## Analytics

| Method | Path | Output |
| :--- | :--- | :--- |
| GET | `/analytics/overview` | capacity, occupancy, utilisation, today's counts |
| GET | `/analytics/parking-utilization` | per zone category |
| GET | `/analytics/visitor-trends?days=` | invitations, entries, exits per day |
| GET | `/analytics/overstays` | active occupancies past departure |
| GET | `/notifications?unread_only=&limit=&offset=&channel=` | current user's notifications (defaults to `IN_APP`) |
| GET | `/notifications/unread-count` | unread badge count |
| POST | `/notifications/{id}/read` | mark one owned notification read |
| POST | `/notifications/read-all` | mark every owned in-app notification read |

Email delivery rows are intentionally excluded from the in-app list. They are dispatched by
`python -m app.workers.notifications` and transition `PENDING → SENT | SKIPPED | FAILED` with bounded retries.

## Verification example

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"resident@skyline.dev","password":"ParkVanta@2026"}' | jq -r .access_token)

curl -s -X POST http://localhost:8080/api/v1/invitations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"visitor_name":"Rahul Sharma","vehicle_registration":"KA01AB1234",
       "visitor_type":"GUEST","expected_arrival":"2026-11-08T18:30:00Z",
       "expected_departure":"2026-11-08T21:30:00Z"}'
```

## Idempotency notes

- `POST /parking/allocate` returns the existing active reservation instead of double-allocating.
- `POST /gate/entry/confirm` returns the existing occupancy with `already_confirmed: true`.
- `POST /gate/exit/confirm` is deliberately **not** idempotent: a second call returns `409 already_exited`
  so repeated barrier operations stay visible.
- `POST /gate/offline/reconcile` is idempotent per `(property_id, client_event_id)`: a replay reports
  `duplicate` and performs no second transition. A batch accepts 1–50 actions, each with `recorded_at`,
  `device_id`, and a supported action (`ENTRY_CONFIRM`, `EXIT_CONFIRM`, `MANUAL_OVERRIDE`).
