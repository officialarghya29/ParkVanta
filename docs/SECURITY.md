# ParkVanta — Security Model

## 1. Threat model

| Asset | Threat | Control |
| :--- | :--- | :--- |
| Visitor entry | Forged or replayed QR | Server-side validation, hashed single-use tokens, atomic consumption |
| Parking inventory | Double allocation | Row locks, `SKIP LOCKED`, partial unique indexes |
| Offline queue | Replay / forged entry | Online-only authorization, unique client-event ledger, clock checks |
| Tenant data | Cross-society reads | Query scoping + service assertions + regression tests |
| Accounts | Credential stuffing | Argon2id, login rate limits, generic failure messages |
| Sessions | Refresh token theft | Rotation, family revocation on replay, httpOnly cookie |
| Gate decisions | Unlogged overrides | Mandatory reason, immutable event + audit row |
| PII | Over-collection | No PII in QR, visitor-safe projection, no contact data in analytics |

Explicitly out of scope: facial recognition and any biometric processing.

## 2. Authentication and sessions

- **Hashing:** Argon2id via `argon2-cffi` (3 iterations, 64 MiB, parallelism 4). Rehash-on-login when parameters
  change.
- **Access token:** JWT HS256, 15 minutes, includes `sub`, `org`, `role`, `jti`. Role and org are re-checked
  against the database on every request; a stale role token is rejected.
- **Refresh token:** 48 random bytes, only its SHA-256 hash is stored. Rotated on use. Presenting an already
  rotated token revokes every active session for that user (replay detection).
- **Cookies:** refresh cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Password reset:** 30-minute hashed token, single use; successful reset revokes all refresh tokens. Responses
  never reveal whether an email exists.

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

## 5. Tenant isolation

- All queries filter `organization_id`; operational tables also filter `property_id`.
- `assert_property_access` loads the property and checks organization + user assignment.
- Residents are filtered to `resident_user_id = current_user.id`.
- Cross-tenant attempts return `403`; tests assert this for properties, parking inventory and invitations.

## 6. Auditing

Recorded actions include: registration, login success/failure, refresh replay, account creation, invitation
create/approve/reject/cancel, pass revocation, entry authorization, entry confirm, exit, manual override,
slot changes and policy changes. Audit rows include organization, actor, entity, IP where available, and JSON
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

## 7. Application hardening

- Pydantic validation on every request; SQLAlchemy parameterisation (no string SQL with user input).
- CORS restricted to configured origins with credentials.
- Security headers on the SPA served by Nginx.
- Consistent, sanitized error envelope; stack traces never returned.
- Secrets from environment; `.env` is git-ignored; the app refuses to start in production with the default
  development JWT secret.
- Rate limiting on login and refresh, backed by Redis when present.
- File uploads are not part of the current surface.

## 8. Privacy (DPDP-aligned design)

- Collect only visitor name, optional phone, optional vehicle and visit window.
- Visitor contact details are never returned on the public pass endpoint or in analytics.
- Configurable retention (see `DATABASE_DESIGN.md`); no camera storage in this release.
- Data-subject requests are handled at the society level; the platform provides scoped export/delete tooling as
  an operational procedure, not an exposed endpoint.

## 9. Known security limitations

- Access tokens are stored in `localStorage` for SPA convenience; a strict CSP and short TTL mitigate, but
  in-memory-only storage is the next hardening step.
- Rate limiting falls back to per-process state if Redis is unavailable.
- No automated dependency CVE gate in CI yet (planned: `pip-audit`, `npm audit --production`).
- Email/SMS delivery is not configured; reset tokens are logged only in non-production environments.
