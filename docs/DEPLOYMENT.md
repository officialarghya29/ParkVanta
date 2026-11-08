# ParkVanta — Deployment

## 1. Local development

```bash
cp .env.example .env
docker compose up -d db redis        # PostgreSQL 16 on 55432, Redis on 56379
make install                         # .venv + backend dependencies
make migrate                         # Alembic upgrade head
make seed                            # demo society + accounts
make api                             # http://localhost:8080  (docs at /docs)
make web                             # http://localhost:5173
```

Verify: `curl http://localhost:8080/health` and `curl http://localhost:8080/ready`.

## 2. Environment

| Variable | Required | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | ✅ | `postgresql+psycopg://…` |
| `JWT_SECRET` | ✅ | ≥ 24 chars; generate with `openssl rand -hex 48` |
| `ENVIRONMENT` | ✅ | `production` enables secret validation and secure cookies |
| `REDIS_URL` | recommended | Rate limiting falls back to per-process state |
| `CORS_ORIGINS` | ✅ | Comma-separated SPA origins |
| `TRUSTED_PROXIES` | behind a proxy | Comma-separated proxy IPs/CIDRs allowed to set `X-Forwarded-For`; empty ignores it |
| `APP_PUBLIC_URL` | ✅ | Public SPA origin used in password-reset links |
| `SMTP_HOST` | for reset | Mail relay host; leave empty only in development |
| `SMTP_PORT` | for reset | Default `587`; use `465` with `SMTP_USE_SSL=true` |
| `SMTP_FROM` | for reset | Sender address/display name |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | if required | Relay credentials, stored in the secret manager |
| `SMTP_USE_TLS` / `SMTP_USE_SSL` | for reset | STARTTLS (587) or implicit TLS (465) |
| `EVENT_RETENTION_DAYS` | recommended | Durable SSE archive retention; default `30` |
| `METRICS_TOKEN` | recommended | Bearer token required by `/metrics`; leave empty only on a private network |
| `OUTBOX_STALE_MINUTES` | recommended | Health limit for the oldest queued email; default `10` |
| `WORKER_STALE_MINUTES` | recommended | Health limit for worker heartbeat age; default `5` |
| `SEED_PASSWORD` | dev only | Demo account password; never used by `app.bootstrap` |

Secrets belong in a managed secret store, never in the image or repository.

### 2.1 First-run provisioning

Run once against an empty database after migrations:

```bash
export BOOTSTRAP_ORG_NAME='Skyline Communities'
export BOOTSTRAP_ORG_SLUG='skyline'
export BOOTSTRAP_PROPERTY_NAME='Skyline Residency'
export BOOTSTRAP_ADMIN_NAME='Ananya Rao'
export BOOTSTRAP_ADMIN_EMAIL='admin@example.com'
export BOOTSTRAP_ADMIN_PASSWORD="$(openssl rand -hex 16)"
cd backend && ../.venv/bin/python -m app.bootstrap
```

The command creates one organization, property, policy and society admin. It refuses an existing slug or email and
prints the property join code. Do not use `app.seed` for a real installation.

In the web app, the admin shares the join code, residents register at `/register`, and the admin verifies each
account in **Inventory → Resident accounts** before the resident can issue invitations. Configure SMTP before
go-live and send one real password-reset email as an acceptance check.

## 3. Production topology

```text
Internet → TLS / WAF / ingress
             ├── static SPA  (apps/web image, Nginx, immutable assets)
             └── /api/*      (backend image, uvicorn workers)
                                 ├── managed PostgreSQL (backups, PITR)
                                 ├── managed Redis
                                 ├── expiry worker (scheduled)
                                 ├── notification outbox worker (scheduled)
                                 └── worker health check (scheduled)
```

Set `TRUSTED_PROXIES` to the ingress/load-balancer CIDR (for example `10.0.0.0/8`) so rate limits and audit rows
use the client address rather than the proxy address. Leave it empty when clients connect directly.

Backend image: `backend/Dockerfile` (non-root user, healthcheck). Web image: `apps/web/Dockerfile` (multi-stage
build → Nginx). A reference reverse-proxy config is in `infrastructure/nginx/parkvanta.conf`. Prometheus can scrape
`/metrics` through the ingress; set `METRICS_TOKEN` or restrict that path to the monitoring network.

## 4. Release procedure

1. Build and tag images from the release commit.
2. Back up PostgreSQL (`pg_dump` or managed snapshot).
3. Run migrations as a one-off job: `alembic upgrade head`.
4. On a fresh database, run `python -m app.bootstrap` once and record the join code.
5. Deploy the API, web assets and both scheduled workers.
6. Hit `/health` and `/ready`; confirm a login, one gate verification, one password-reset email and one queued
   visitor email marked `SENT`. Scrape `/metrics` and run the worker health check after the first worker cycle.
   Then run `python -m app.pilot_preflight`; it must exit 0 before a real pilot is declared ready.
7. Keep the previous image tag for rollback.

**Rollback:** redeploy the previous image tag. Schema changes must be backward compatible for one release;
destructive migrations require a separate, planned step.

## 5. Background jobs

```bash
python -m app.workers.expiry
python -m app.workers.notifications
python -m app.workers.health
```

Run the two workers every 60 seconds via cron, a Kubernetes CronJob, or a scheduled container. The expiry sweep
expires passes/reservations/invitations, flags overstays and purges realtime events older than
`EVENT_RETENTION_DAYS`. The notification worker drains the email outbox with `FOR UPDATE SKIP LOCKED`, retries SMTP
failures and records `SENT`, `SKIPPED` or `FAILED`. Both write a `worker_heartbeats` row on success and are
idempotent and safe to overlap. Run the health check every 5 minutes; it exits non-zero on any `FAILED` row, a
stale `PENDING` email, or a missing/stale heartbeat. Triage and requeue queries are in the pilot runbook §6.1.

## 6. Backups and recovery

- Managed PostgreSQL with daily snapshots and point-in-time recovery; test a restore quarterly.
- Redis holds no authoritative data and can be flushed.
- Store the object-storage bucket (future vision images) with lifecycle rules.
- Document the recovery time objective (RTO ≤ 1 hour) and recovery point objective (RPO ≤ 15 minutes) with the
  hosting provider's guarantees.

## 7. Monitoring

| Signal | Where |
| :--- | :--- |
| Liveness / readiness | `/health`, `/ready` |
| API latency and 5xx rate | ingress + application logs |
| Gate denial reasons | `entry_exit_events` + audit log |
| Overstays | analytics endpoint / worker log |
| Database saturation | managed metrics |
| Reservation expiry lag | worker cadence / heartbeat |
| Email outbox and worker freshness | `/metrics` scrape |
| Worker health | `python -m app.workers.health` exit status |

Ready-made artifacts live in `infrastructure/monitoring/`: `prometheus-rules.yml` covers `FAILED` rows, a stale
oldest-pending age, repeated retries and missing heartbeats; `grafana-dashboard.json` graphs outbox status, oldest
pending age, retry attempts and worker heartbeat age. Import both and select the Prometheus datasource.

Alerts worth paging on: `/ready` failing, 5xx > 2% for 5 minutes, login failure spike, `no_slot_available`
spike (capacity or policy problem), gate authorization errors, any `FAILED` email row, oldest `PENDING` email over
10 minutes, or `parkvanta_worker_up == 0`.

## 8. CI/CD

`.github/workflows/ci.yml` runs on every push/PR:

```text
backend:  alembic upgrade (service Postgres) → pytest
frontend: npm ci → tsc + vite build → bundle budget
e2e:      pip + npm ci → playwright install chromium → full lifecycle test
security: ruff → pip-audit → npm audit (production and dev)
images:   docker build API + web → size budgets
```

The E2E job installs Chromium and sets `PLAYWRIGHT_CHANNEL=chromium`; the bootstrap script resolves either the
repository virtualenv or the CI-installed Python/alembic/uvicorn binaries. Deployment is intentionally not
automatic yet.

## 9. Pilot

Use the dedicated [single-property pilot runbook](PILOT_RUNBOOK.md). It covers go/no-go checks, deployment,
backup and restore, monitoring thresholds, incident procedures and pilot exit criteria.

Quick backup while the compose database is running:

```bash
make pilot-backup
# writes ./backups/parkvanta-<UTC timestamp>.dump.gz and prunes files older than 14 days
```
