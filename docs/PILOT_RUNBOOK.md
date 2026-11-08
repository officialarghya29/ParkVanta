# ParkVanta — Single-Property Pilot Runbook

**Status:** ready for a controlled single-property pilot. This is not a certification for multi-tenant production.
**Scope:** one society, one gate, 1–2 lanes, 10–20 visitor bays, 2–4 guards, one pilot owner.
**Goal:** prove that the ledger works in daily operation — not that the demo looks good.

---

## 1. Go / no-go criteria

Do not start the pilot until every item is true.

| Area | Requirement |
| :--- | :--- |
| Hardware | Gate tablet/phone charged, mounted, camera working, spare device available |
| Network | Gate Wi-Fi or cellular verified; offline queue procedure demonstrated to every guard |
| Identity | Real society admin and guard accounts created; demo accounts disabled or rotated |
| Inventory | Towers, apartments, visitor/service/reserved zones and bays match the physical property |
| Policy | Visitor window, QR validity, overstay grace and manual override reviewed with the society |
| Data | Production PostgreSQL reachable, migrations at head, backup taken and restore rehearsed |
| Secrets | Unique `JWT_SECRET`, database password and Redis password; no defaults |
| Monitoring | `/health`, `/ready`, error-rate and backup-age alerts routed to a named on-call person |
| Training | Guards have completed the acceptance script in §7 and know the printed override fallback |

### Pilot success metrics

Tracked weekly; these are pilot targets, not recorded product results.

| Metric | Target |
| :--- | :--- |
| Double-allocation incidents | **0** |
| Wrong-vehicle entries without an override reason | **0** |
| Gate verification p95 (human-observed) | ≤ 3 s |
| Successful first-scan rate | ≥ 95% |
| Offline actions reconciled exactly once | 100% |
| Active visitor limit breaches | 0 |
| Guard-reported blocking defects | 0 open at exit |

---

## 2. Topology

```text
Internet
  └── TLS / reverse proxy
        ├── static SPA (immutable assets, Nginx)
        └── /api/* → uvicorn (2 workers)
                       ├── PostgreSQL 16 (authoritative, PITR)
                       ├── Redis 7 (limits, live Streams, pub/sub)
                       ├── expiry worker (every 60 s)
                       └── notification outbox worker (every 60 s)
```

Single host is acceptable for a controlled pilot if backups leave the host. PostgreSQL and Redis must not be
publicly reachable. The SPA and API share one origin so CORS stays narrow.

---

## 3. Environment

| Variable | Pilot value |
| :--- | :--- |
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | `postgresql+psycopg://…` with a unique password |
| `JWT_SECRET` | `openssl rand -hex 48`; store in the secret manager |
| `REDIS_URL` | Private Redis URL; no public port |
| `CORS_ORIGINS` | Exactly the pilot HTTPS origin |
| `APP_PUBLIC_URL` | The pilot HTTPS origin, used in password-reset links |
| `SMTP_*` | Society mail relay; required for password reset and visitor email |
| `EVENT_RETENTION_DAYS` | `30` by default; durable SSE replay window |
| `METRICS_TOKEN` | Optional bearer token for `/metrics`; set unless scraping over a private network |
| `VITE_API_BASE_URL` | `/api/v1` when served behind the same origin |

The API refuses to start in production with the default development JWT secret.

---

## 4. Bootstrap and deploy

> Production uses `app.bootstrap`, not the demo seed. The bootstrapper creates one organization, one property,
> its policy and the first society administrator. It refuses an existing slug or email and creates no demo
> accounts. Keep `BOOTSTRAP_ADMIN_PASSWORD` in a root-only env file; it must contain letters and digits.

```bash
# 1. Build immutable images from the release commit
docker build -t parkvanta-api:<sha> backend
docker build -t parkvanta-web:<sha> apps/web

# 2. Start PostgreSQL and Redis (private network; no public ports)
docker compose up -d db redis

# 3. Apply migrations as a one-off job (never on every API restart)
export DATABASE_URL='postgresql+psycopg://…'
export JWT_SECRET='<48-byte secret>'
docker run --rm --env DATABASE_URL --env JWT_SECRET parkvanta-api:<sha> alembic upgrade head

# 4. One-time pilot bootstrap (empty DB only; values from /etc/parkvanta/bootstrap.env)
docker run --rm --env-file /etc/parkvanta/bootstrap.env parkvanta-api:<sha> \
  python -m app.bootstrap
# Record the printed property join code. Residents use it at /register; an admin verifies them in Inventory.

# 5. Start the API with two workers
docker run -d --name parkvanta-api --env-file /etc/parkvanta/pilot.env \
  -p 127.0.0.1:8000:8000 parkvanta-api:<sha> \
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2

# 6. Schedule the expiry and notification workers every minute
* * * * * docker run --rm --env-file /etc/parkvanta/pilot.env parkvanta-api:<sha> \
  python -m app.workers.expiry >> /var/log/parkvanta-expiry.log 2>&1
* * * * * docker run --rm --env-file /etc/parkvanta/pilot.env parkvanta-api:<sha> \
  python -m app.workers.notifications >> /var/log/parkvanta-notifications.log 2>&1

# 7. Every five minutes, fail loudly if the outbox or a heartbeat is stale
*/5 * * * * docker run --rm --env-file /etc/parkvanta/pilot.env parkvanta-api:<sha> \
  python -m app.workers.health >> /var/log/parkvanta-health.log 2>&1
```

Serve the built SPA through Nginx, proxy `/api/` to the API, terminate TLS, add HSTS and a strict CSP. Keep the
previous image tag for rollback. Do not expose the compose development web container in the pilot.

### First login checks

```bash
curl -fsS https://pilot.example.com/health
curl -fsS https://pilot.example.com/ready
curl -fsS -X POST https://pilot.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@…","password":"…"}' | head -c 300
```

Then open **Inventory**, copy the society join code, register one test resident at `/register`, verify the account
in **Resident accounts**, and confirm that resident can issue and approve one invitation. Send one password-reset
email to a real mailbox before go-live.

---

## 5. Backups

Redis is not authoritative and can be flushed; PostgreSQL is the ledger. A backup that has never been restored is
not a backup.

```bash
# On the pilot host, from the repository root (Compose service 'db')
make pilot-backup
# → backups/parkvanta-<UTC timestamp>.dump.gz, gzip integrity checked, 14-day retention

# If PostgreSQL runs in a named container instead of Compose:
PG_CONTAINER=parkvanta-pg make pilot-backup
```

Schedule it daily at a quiet hour and copy the result off-host (object storage or encrypted backup target).

| Control | Target |
| :--- | :--- |
| Recovery point objective (RPO) | ≤ 24 h with daily dumps; ≤ 15 min with managed PITR |
| Recovery time objective (RTO) | ≤ 1 h for a single-property pilot |
| Retention | 14 daily dumps locally; 90 days off-host |
| Restore drill | Weekly into a staging database; record duration and row counts |

### Restore drill (never against the live database)

```bash
createdb -h <host> -U <user> parkvanta_restore
gunzip -c backups/parkvanta-<timestamp>.dump.gz \
  | pg_restore -h <host> -U <user> -d parkvanta_restore --clean --if-exists --no-owner
psql -h <host> -U <user> -d parkvanta_restore -c \
  "select count(*) from invitations; select count(*) from entry_exit_events;"
```

Promote only after the restored copy passes `/ready`, a login and one read-only gate query. Record the drill in the
pilot log.

---

## 6. Monitoring and alerts

| Signal | Source | Page when |
| :--- | :--- | :--- |
| Liveness | `/health` every 30 s | 2 consecutive failures |
| Readiness (DB) | `/ready` every 30 s | 2 consecutive failures |
| API 5xx rate | ingress/application logs | > 2% for 5 min |
| p95 API latency | ingress metrics | > 1,500 ms for 10 min |
| Gate denials | `entry_exit_events` / gate console | sudden spike in `vehicle_mismatch` or `authorization_required` |
| No-slot events | `no_slot_available` audit rows | > 5 in 10 min during expected low demand |
| PostgreSQL | managed metrics | connections > 80%, disk > 80%, replication lag |
| Redis | managed metrics | unavailable > 5 min (gate writes still work; realtime degrades) |
| Expiry worker | cron log | last successful run > 5 min |
| Notification outbox | `notifications` status/error | oldest `PENDING` > 10 min or any `FAILED` |
| Outbox metrics | `/metrics` scrape | oldest `PENDING` over limit, `FAILED` > 0, or `worker_up == 0` |
| Worker health | `python -m app.workers.health` | non-zero exit |
| Backup age | backup directory / object storage | newest dump > 26 h |

Daily checks:

```bash
curl -fsS https://pilot.example.com/ready
docker logs --since 24h parkvanta-api | grep -E 'ERROR|Unhandled'
psql "$DATABASE_URL" -c "select decision, count(*) from entry_exit_events group by decision;"
ls -lh backups/ | tail -3
```

Weekly checks: restore drill, overstay review, guard feedback, dependency audit (`make audit`), and a review of
manual overrides for reason quality.

### 6.1 Notification outbox alerts and recovery

Visitor email is queued in `notifications` and only leaves `PENDING` when SMTP accepts or rejects it. In-app notes
arrive regardless, so a stuck outbox never blocks a gate decision. Each successful worker run updates
`worker_heartbeats`; `make worker-health` reads it and exits non-zero when the scheduler stops.

| Signal | Query threshold | Page when |
| :--- | :--- | :--- |
| Failed email | `status = 'FAILED'` | Any row |
| Stuck queue | oldest `PENDING` email | > 10 minutes old |
| Repeated retries | `attempts >= 3` on `PENDING` | Any row |
| Worker stopped | last `notification dispatch complete` log line | > 5 minutes old |

Prometheus rules for these thresholds ship in `infrastructure/monitoring/prometheus-rules.yml`; the companion
Grafana dashboard is `infrastructure/monitoring/grafana-dashboard.json`.

```sql
-- Outbox health; run every 5 minutes and export the values as metrics
select status, count(*),
       min(created_at) filter (where status = 'PENDING') as oldest_pending,
       max(attempts) filter (where status = 'PENDING') as max_attempts
from notifications
where channel = 'EMAIL'
group by status;

-- Rows that need an operator
select id, user_id, title, attempts, created_at, next_attempt_at, left(error, 120)
from notifications
where channel = 'EMAIL'
  and (status = 'FAILED'
       or (status = 'PENDING' and created_at < now() - interval '10 minutes'))
order by created_at
limit 20;
```

Triage order:

1. Check the cron entry and the worker log for the last successful run. A missing run is fixed by the scheduler, not
   by editing rows.
2. Confirm `SMTP_HOST`, `SMTP_FROM` and relay credentials in the pilot environment; run
   `python -m app.workers.notifications` once by hand and read the logged counters.
3. Fix the relay before requeueing. Requeue only rows created in the last 24 hours; older visitor notices are stale,
   and the in-app note is already authoritative.

```sql
-- After the relay is fixed: retry FAILED/SKIPPED rows from the last 24 hours
update notifications
set status = 'PENDING', attempts = 0, next_attempt_at = now(), error = null, sent_at = null
where channel = 'EMAIL'
  and status in ('FAILED', 'SKIPPED')
  and created_at > now() - interval '24 hours';
```

Never set `status = 'SENT'` by hand: `SENT` means the relay accepted the message. Do not paste email bodies or visitor
contact details into tickets; use notification ids and the error column.

---

## 7. Guard acceptance script

Run this on the actual gate device before go-live.

1. Sign in as a guard; confirm only the pilot property is visible.
2. Ask a resident to create and approve a visitor with a vehicle.
3. Scan or paste the pass; verify the plate matches.
4. Authorize entry, confirm entry, check the vehicle appears inside and the bay becomes occupied.
5. Disconnect the device from the network.
6. Confirm entry verification is blocked; confirm an exit can be queued.
7. Reconnect; confirm the queue shows synced and the bay is released exactly once.
8. Repeat the same pass scan; it must be rejected as already used.
9. Open the printed fallback card and record one manual override with a real reason.

Every guard signs the pilot training sheet after completing all nine steps.

---

## 8. Incident procedures

### API down

```bash
curl -v https://pilot.example.com/health
docker ps --filter name=parkvanta-api
docker logs --tail 200 parkvanta-api
```

Roll back to the previous image tag if the failure started with a release. Database outages fail closed for entry;
do not bypass the ledger with an ad-hoc database edit.

### PostgreSQL unavailable

Stop gate writes, switch to the printed manual register, and treat all entries as overrides to be reconciled after
recovery. Restore from the latest verified dump or promote the managed replica. Never point the API at a restored
copy and the live database at the same time.

### Redis unavailable

Realtime and cross-process events degrade; REST remains authoritative. Gate authorization and occupancy still
write to PostgreSQL. Restore Redis and reconnect clients; clients refetch state.

### Suspected double allocation

```sql
select slot_id, count(*) from parking_reservations
where status = 'ACTIVE' group by slot_id having count(*) > 1;

select slot_id, count(*) from parking_occupancies
where status = 'ACTIVE' group by slot_id having count(*) > 1;
```

Any row is a P0. Capture the rows, the audit trail and request logs before correcting data. The partial unique
indexes should make this impossible; a row means an invariant or migration failed.

### Lost guard device / unsynced queue

Revoke the guard session, disable the account, and inspect the offline ledger for that device. Queued actions that
never reached the server are lost with the browser profile; record them manually and audit each one.

### Pass abuse or wrong vehicle

Revoke the pass from the resident/admin console, record a manual override with the observed plate, and preserve the
gate event rows. Do not delete audit records.

---

## 9. Rollback and exit

**Release rollback:** redeploy the previous API and web image tags. Migrations must be backward compatible for one
release; destructive schema changes need a separate planned window.

**Pilot exit:** stop onboarding, export the pilot metrics, review every manual override and P0, and decide:

- **Continue** — all success metrics met, no open P0.
- **Conditional** — fix listed issues within two weeks, keep guards on the manual fallback for affected flows.
- **Stop** — any double allocation, unexplained occupancy, or repeated authorization bypass.

The pilot is not a production certification. Multi-property operations, outbound visitor notifications and the
vision pipeline remain separate work.
