# ParkVanta — Security Model

## 1. Threat model

| Asset | Threat | Control |
| :--- | :--- | :--- |
| Visitor entry | Forged or replayed QR | Server-side validation, hashed single-use tokens, atomic consumption |
| Parking inventory | Double allocation | Row locks, `SKIP LOCKED`, partial unique indexes |
| Offline queue | Replay / forged entry | Online-only authorization, unique client-event ledger, clock checks |
| Tenant data | Cross-society reads | Query scoping + service assertions + regression tests |
| Accounts | Credential stuffing | Argon2id, login rate limits, generic failure messages |
| Onboarding | Outsider joins a society | 64-bit join code, admin-only retrieval/rotation, admin verification |
| Sessions | Refresh token theft | Rotation, family revocation on replay, httpOnly cookie |
| Gate decisions | Unlogged overrides | Mandatory reason, immutable event + audit row |
| PII | Over-collection | No PII in QR, visitor-safe projection, no contact data in analytics |

Explicitly out of scope: facial recognition and any biometric processing.

## 2. Authentication and sessions

- **Hashing:** Argon2id via `argon2-cffi` (3 iterations, 64 MiB, parallelism 4). Rehash-on-login when parameters
  change.
- **Access token:** JWT HS256, 15 minutes, includes `sub`, `org`, `role`, `jti`. Role and org are re-checked
  against the database on every request; a stale role token is rejected. The browser keeps it in JavaScript
  memory only, never in localStorage; a reload restores the session through the httpOnly refresh cookie.
- **Refresh token:** 48 random bytes, only its SHA-256 hash is stored. Rotated on use. Presenting an already
  rotated token revokes every active session for that user (replay detection).
- **Cookies:** refresh cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Password reset:** 30-minute hashed token, single use; successful reset revokes all refresh tokens. Responses
  never reveal whether an email exists. The link is delivered through the configured SMTP relay; in production a
  missing or failing relay returns 503 instead of silently logging the token. Development logs the link only when
  SMTP is unconfigured.
- **First admin:** `python -m app.bootstrap` creates one organization, property, policy and society admin. It
  refuses an existing slug or email and never creates demo accounts.

## 3. Authorization matrix

| Capability | Super admin | Society admin | Property manager | Guard | Resident |
| :--- | :-: | :-: | :-: | :-: | :-: |
| Create organization | ✅ | — | — | — | — |
| Manage properties / towers | ✅ | ✅ | ✅ | — | — |
| Manage residents / guards | ✅ | ✅ | ✅ | — | — |
| Manage parking inventory | ✅ | ✅ | ✅ | — | — |
| Update society policy | ✅ | ✅ | ✅ | — | — |
| Create invitation | — | — | — | — | ✅ |
| Approve / reject invitation | ✅ | ✅ | ✅ | — | owner only |
| Verify / authorize entry | ✅ | ✅ | ✅ | ✅ | — |
| Confirm entry / exit | ✅ | ✅ | ✅ | ✅ | — |
| Manual override | — | ✅ | ✅ | ✅ | — |
| View analytics | ✅ | ✅ | ✅ | ✅ | — |

Roles are enforced in FastAPI dependencies and again in services. Hiding a button is never the control.

## 4. QR pass security

1. 256 bits from `secrets.token_urlsafe(32)`.
2. Only `sha256(token)` is persisted — a database leak does not yield usable passes.
3. Validation order: existence → society/property → revoked → consumed → expiry → arrival grace → invitation
   status → vehicle match → visitor window → reservation.
4. Consumption: `UPDATE qr_passes SET status='CONSUMED' WHERE id=:id AND status='ACTIVE'`; the losing request
   receives `409 already_used`.
5. Revocation is immediate and server-side; cancellation also releases the slot.
6. The QR encodes a URL containing the token, never visitor details.

## 4.1 Society join codes

- A property join code is 16 hexadecimal characters (64 bits) generated with `secrets.token_hex(8)`.
- Only society admins and property managers can read or rotate it.
- The public lookup returns the property name/address and apartment labels needed to register; it never returns
  residents, contact details, occupancy or parking inventory.
- Registration still requires an explicit apartment id from that lookup; the account starts `is_verified=False`.
- Rotating the code immediately invalidates the previous value.

## 5. Tenant isolation

- All queries filter `organization_id`; operational tables also filter `property_id`.
- `assert_property_access` loads the property and checks organization + user assignment.
- Residents are filtered to `resident_user_id = current_user.id`.
- Cross-tenant attempts return `403`; tests assert this for properties, parking inventory and invitations.

## 6. Auditing

Recorded actions include: bootstrap, registration, login success/failure, refresh replay, account creation,
join-code rotation, invitation create/approve/reject/cancel, pass revocation, entry authorization, entry confirm,
exit, manual override, slot changes and policy changes. Audit rows include organization, actor, entity, IP where available, and JSON
metadata, and are written in the same transaction as the operation.

## 6.1 Offline gate actions

- A disconnected guard device **cannot authorize a pass**. `ENTRY_CONFIRM` is accepted only when an
  `AUTHORIZED` entry event already exists for the invitation; otherwise the action is rejected with
  `authorization_required`.
- Queue entries carry `client_event_id`, `device_id` and `recorded_at`. The unique
  `(property_id, client_event_id)` index makes retries idempotent.
- Timestamps more than 5 minutes ahead of server time are rejected (`clock_mismatch`); actions older than
  7 days are rejected (`stale_action`). Server `created_at` is authoritative for audit ordering.
- Local storage is convenience state, not trust: reconciliation always reloads the invitation, occupancy and
  slot state from PostgreSQL and enforces guard/property scope.

## 6.2 Realtime stream tickets

- Stream tickets are signed JWTs scoped to one property, valid for 2 minutes, and verified against the
  account's organization and active status before the stream opens.
- The access token is never placed in a URL or query string.
- Frames contain ids, event types and slot codes only; no visitor names, phones or plate numbers.
- Events are advisory. A missing stream cannot block, authorize or release anything; REST refetch is the
  recovery path.

## 6.3 Entry confirmation and authorization

- `POST /gate/entry/confirm` requires an existing `ENTRY/AUTHORIZED` event for the invitation. A caller cannot
  create an occupancy directly and bypass the single-use pass.
- Offline entry confirmation applies the same check before calling the normal gate service.
- Society-wide offline exits use the explicit `property_id` from the reconcile request; an account with no
  assigned property is not forced through an invalid assertion.

## 6.4 Metrics endpoint

- `/metrics` exposes aggregate email-outbox counts and worker heartbeat timestamps only; it never returns visitor
  data, email bodies or credentials.
- Set `METRICS_TOKEN` to require `Authorization: Bearer <token>`. Without it, restrict the path to the monitoring
  network at the ingress; the endpoint is excluded from the public OpenAPI schema.

## 7. Application hardening

- Pydantic validation on every request; SQLAlchemy parameterisation (no string SQL with user input).
- CORS restricted to configured origins with credentials.
- Security headers on the SPA served by Nginx.
- Consistent, sanitized error envelope; stack traces never returned.
- Secrets from environment; `.env` is git-ignored; the app refuses to start in production with the default
  development JWT secret.
- Rate limiting on login and refresh, backed by Redis when present.
- File uploads are not part of the current surface.
- CI blocks on Ruff, `pip-audit`, npm audits for production and dev dependencies, the frontend gzip budget and
  Docker image size budgets; Bandit high-severity is clean.
  The Python and Node audit results are both zero advisories at the recorded commit.

## 8. Privacy (DPDP-aligned design)

- Collect only visitor name, optional phone, optional vehicle and visit window.
- Visitor contact details are never returned on the public pass endpoint or in analytics.
- Configurable retention (see `DATABASE_DESIGN.md`); no camera storage in this release.
- Data-subject requests are handled at the society level; the platform provides scoped export/delete tooling as
  an operational procedure, not an exposed endpoint.

## 9. Known security limitations

- Rate limiting falls back to per-process state if Redis is unavailable.
- Visitor email is queued in a status-tracked outbox and retried with backoff; the notification worker must be
  scheduled. SMS/WhatsApp delivery is not implemented. Password reset requires SMTP; production fails closed with
  503 when delivery is unavailable.
