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
| `APP_PUBLIC_URL` | ✅ | Public SPA origin used in password-reset links |
| `SMTP_HOST` | for reset | Mail relay host; leave empty only in development |
| `SMTP_PORT` | for reset | Default `587`; use `465` with `SMTP_USE_SSL=true` |
| `SMTP_FROM` | for reset | Sender address/display name |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | if required | Relay credentials, stored in the secret manager |
| `SMTP_USE_TLS` / `SMTP_USE_SSL` | for reset | STARTTLS (587) or implicit TLS (465) |
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
                                 └── expiry worker (scheduled)
```

Backend image: `backend/Dockerfile` (non-root user, healthcheck). Web image: `apps/web/Dockerfile` (multi-stage
build → Nginx). A reference reverse-proxy config is in `infrastructure/nginx/parkvanta.conf`.

## 4. Release procedure

1. Build and tag images from the release commit.
2. Back up PostgreSQL (`pg_dump` or managed snapshot).
3. Run migrations as a one-off job: `alembic upgrade head`.
4. On a fresh database, run `python -m app.bootstrap` once and record the join code.
5. Deploy the API, then the web assets.
6. Hit `/health` and `/ready`; confirm a login, one gate verification and one password-reset email.
7. Keep the previous image tag for rollback.

**Rollback:** redeploy the previous image tag. Schema changes must be backward compatible for one release;
destructive migrations require a separate, planned step.

## 5. Background jobs

```bash
python -m app.workers.expiry
```

Run every 60 seconds via cron, a Kubernetes CronJob, or a scheduled container. The sweep expires passes,
reservations and stale invitations, and flags overstays. It is idempotent and safe to overlap.

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
| Reservation expiry lag | worker cadence |

Alerts worth paging on: `/ready` failing, 5xx > 2% for 5 minutes, login failure spike, `no_slot_available`
spike (capacity or policy problem), and gate authorization errors.

## 8. CI/CD

`.github/workflows/ci.yml` runs on every push/PR:

```text
backend:  alembic upgrade (service Postgres) → pytest
frontend: npm ci → tsc + vite build
e2e:      pip + npm ci → playwright install chromium → full lifecycle test
security: ruff → pip-audit → npm audit --omit=dev --audit-level=high
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
