# ParkVanta — Deployment

## 1. Local development

```bash
cp .env.example .env
docker compose up -d db redis        # PostgreSQL 16 on 55432, Redis on 56379
make install                         # .venv + backend dependencies
make migrate                         # Alembic upgrade head
make seed                            # demo society + accounts
make api                             # http://localhost:8080  (docs at /docs)
make web-install && make web         # Frontend on http://localhost:5173
```

Verify: `curl http://localhost:8080/health` and `curl http://localhost:8080/ready`.

---

## 2. Railway production deployment

ParkVanta is structured as two independent Docker services (`backend/` and `apps/web/`) backed by managed PostgreSQL, managed Redis, and scheduled Railway Cron services for background workers. Do not merge the frontend and backend into one container, and never run `app.seed` in production.

### 2.1 Railway project & GitHub setup

1. Create a new Railway project (`parkvanta-prod`).
2. Connect the GitHub repository (`main` branch).
3. Provision four core services plus scheduled worker services inside the same Railway project.

### 2.2 PostgreSQL and Redis services

1. **PostgreSQL** (`+ New` → `Database` → `Add PostgreSQL`):
   - Enable daily automated backups / PITR in Railway PostgreSQL settings.
   - Expose internal networking (`postgres.railway.internal`); do not expose the database port publicly unless temporarily needed for controlled admin access.
   - Note: Railway supplies `DATABASE_URL` as `postgresql://...` (or `postgres://...`). ParkVanta automatically normalizes `postgres://` and `postgresql://` to `postgresql+psycopg://` for SQLAlchemy and Alembic.
2. **Redis** (`+ New` → `Database` → `Add Redis`):
   - Used only for sliding-window rate limiting and advisory SSE fan-out. PostgreSQL remains authoritative if Redis restarts.
   - Reference its internal connection string via `${{Redis.REDIS_URL}}`.

### 2.3 Service topology & exact configurations

| Service | Root Directory | Dockerfile | Target Port | Public Domain | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL** | — | Managed | `5432` | No | Authoritative ledger |
| **Redis** | — | Managed | `6379` | No | Ephemeral rate limits & SSE pub/sub |
| **Backend API** | `/backend` | `Dockerfile` | `8000` | Yes | Binds `0.0.0.0:${PORT:-8000}` |
| **Frontend Web** | `/apps/web` | `Dockerfile` | `80` | Yes | Multi-stage Vite build → Nginx SPA |
| **Expiry Worker** | `/backend` | `Dockerfile` | — | No | Cron service (`*/5 * * * *`) |
| **Notification Worker** | `/backend` | `Dockerfile` | — | No | Cron service (`*/5 * * * *`) |
| **Worker Health** | `/backend` | `Dockerfile` | — | No | Optional Cron service (`*/10 * * * *`) |

### 2.4 Backend service setup (`/backend`)

1. Create a service from the GitHub repo and set:
   - **Root Directory:** `/backend`
   - **Dockerfile Path:** `Dockerfile` (resolved relative to `/backend`)
   - **Healthcheck Path:** `/health` (liveness; does not depend on Postgres)
   - **Readiness Check (manual / monitoring):** `GET /ready` (checks `SELECT 1` against PostgreSQL)
   - **Target Port:** `8000` (the Dockerfile starts Uvicorn on `0.0.0.0:${PORT:-8000}`)
2. Set the backend environment variables in Railway:

| Variable | Required | Value / Notes |
| :--- | :--- | :--- |
| `ENVIRONMENT` | Yes | `production` (enables strict startup validation and secure cookies) |
| `DEBUG` | Yes | `false` (startup fails if `true` in production) |
| `ENABLE_API_DOCS` | Optional | Leave unset (`false` in production) to hide `/docs`, `/redoc`, and OpenAPI JSON |
| `DATABASE_URL` | Yes | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | Yes | `${{Redis.REDIS_URL}}` |
| `JWT_SECRET` | Yes | Output of `openssl rand -hex 48` (≥ 32 chars; default dev secret is rejected) |
| `ACCESS_TOKEN_MINUTES` | Recommended | `15` |
| `REFRESH_TOKEN_DAYS` | Recommended | `7` |
| `REFRESH_COOKIE_SAMESITE` | Yes | `none` when frontend & backend use separate `*.up.railway.app` domains (or different custom domains); `lax` when sharing the same registrable custom domain (e.g. `app.example.com` + `api.example.com`) |
| `CORS_ORIGINS` | Yes | Exact frontend HTTPS origin(s), comma-separated, no trailing slash, never `*` (e.g. `https://parkvanta-web.up.railway.app`) |
| `ALLOWED_HOSTS` | Yes | Exact backend hostname(s), comma-separated, never `*` (e.g. `parkvanta-api.up.railway.app` or `api.yourdomain.com`) |
| `TRUSTED_PROXIES` | Recommended | Leave empty unless you have verified the Railway edge proxy CIDR; untrusted `X-Forwarded-For` headers are ignored |
| `APP_PUBLIC_URL` | Yes | Public HTTPS frontend URL used in password-reset emails (e.g. `https://parkvanta-web.up.railway.app`) |
| `METRICS_TOKEN` | Yes | Random bearer token (≥ 16 chars) for `/metrics`; `/metrics` fails closed (403) in production if unset |
| `EVENT_RETENTION_DAYS` | Recommended | `30` |
| `OUTBOX_STALE_MINUTES` | Recommended | `15` (aligns with 5-minute Railway cron cadence) |
| `WORKER_STALE_MINUTES` | Recommended | `10` (aligns with 5-minute Railway cron cadence) |
| `SMTP_HOST` | For reset/email | SMTP relay host (e.g. `smtp.postmarkapp.com`, `smtp.resend.com`, `email-smtp.us-east-1.amazonaws.com`) |
| `SMTP_PORT` | For reset/email | `587` (STARTTLS) or `465` (implicit SSL) |
| `SMTP_USERNAME` | For reset/email | Relay username |
| `SMTP_PASSWORD` | For reset/email | Relay password / API key |
| `SMTP_FROM` | For reset/email | Verified sender, e.g. `ParkVanta <no-reply@yourdomain.com>` |
| `SMTP_USE_TLS` | For reset/email | `true` for port `587`, `false` for port `465` |
| `SMTP_USE_SSL` | For reset/email | `false` for port `587`, `true` for port `465` |

> **Important:** Do **not** set `SEED_PASSWORD` or run `app.seed` in production.

### 2.5 Frontend service setup (`/apps/web`)

1. Create a second service from the same GitHub repo and set:
   - **Root Directory:** `/apps/web`
   - **Dockerfile Path:** `Dockerfile`
   - **Healthcheck Path:** `/`
   - **Target Port:** `80`
2. Set the frontend environment variable in Railway:

| Variable | Required | Value / Notes |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Yes | Full HTTPS URL to the backend API prefix, e.g. `https://parkvanta-api.up.railway.app/api/v1` |

How frontend API URL injection works:
- `apps/web/Dockerfile` does **not** embed a `localhost` default. In production builds (`vite build`), `http://localhost:8080/api/v1` is excluded completely.
- Railway passes `VITE_API_BASE_URL` at Docker build time (`ARG VITE_API_BASE_URL`) **and** at container runtime (`ENV VITE_API_BASE_URL`).
- On container startup, `/docker-entrypoint.d/40-parkvanta-env.sh` also writes `window.__PARKVANTA_CONFIG__.API_BASE_URL` to `/usr/share/nginx/html/env-config.js` (served with `Cache-Control: no-store`) and binds Nginx to `${PORT:-80}`. This ensures changing `VITE_API_BASE_URL` works whether applied at build time or container restart.

### 2.6 Custom domains & cookie strategy (`SameSite` + CORS + CSRF)

Because the frontend stores access tokens in memory only and restores sessions across browser reloads using the `parkvanta_refresh` `HttpOnly` cookie:

1. **Separate Railway-generated domains** (`parkvanta-web.up.railway.app` and `parkvanta-api.up.railway.app`):
   - `up.railway.app` is on the Public Suffix List, so browsers treat these two subdomains as **cross-site**.
   - Set `REFRESH_COOKIE_SAMESITE=none` on the backend. This sets `SameSite=None; Secure; HttpOnly; Path=/api/v1/auth` and enforces strict CSRF protection on cookie-authenticated `/auth/refresh` and `/auth/logout` requests (requiring a matching `Origin` in `CORS_ORIGINS`, `Content-Type: application/json`, and `X-Requested-With`).
2. **Custom domains under the same parent domain** (recommended for production, e.g. `app.yourdomain.com` and `api.yourdomain.com`):
   - These share the same registrable site (`yourdomain.com`), so `REFRESH_COOKIE_SAMESITE=lax` (the default) works with `Secure; HttpOnly; Path=/api/v1/auth`.
   - Update `CORS_ORIGINS`, `APP_PUBLIC_URL`, `ALLOWED_HOSTS`, and `VITE_API_BASE_URL` to the custom HTTPS domains and redeploy both services.

---

## 3. Database migrations (one-off deployment step)

Never run Alembic migrations inside the web container's startup `CMD` (multiple replicas or restarts must not race on schema DDL). Run migrations once per release from the `/backend` working directory using Railway CLI (`railway run`) or a Railway pre-deploy / one-off command:

```bash
cd backend && alembic upgrade head
```

Or via Railway CLI linked to the **Backend API** service:

```bash
railway run --service <backend-service-name> alembic upgrade head
```

Verify current revision:

```bash
railway run --service <backend-service-name> alembic current
```

---

## 4. First administrator bootstrap (single-use)

Execute this **once** on an empty, freshly migrated database. Never commit bootstrap credentials to Git.

1. Ensure PostgreSQL is created and `DATABASE_URL` is configured on the backend service.
2. Run `alembic upgrade head` (Section 3).
3. Provide the bootstrap variables temporarily (via Railway CLI shell or temporary service env vars, then remove `BOOTSTRAP_ADMIN_PASSWORD` afterward):
   - `BOOTSTRAP_ORG_NAME`
   - `BOOTSTRAP_ORG_SLUG`
   - `BOOTSTRAP_PROPERTY_NAME`
   - `BOOTSTRAP_ADMIN_NAME`
   - `BOOTSTRAP_ADMIN_EMAIL`
   - `BOOTSTRAP_ADMIN_PASSWORD` (≥ 8 chars, letters and digits)
4. Run once from `/backend`:

```bash
python -m app.bootstrap
```

Via Railway CLI (recommended so secrets stay out of Railway service config):

```bash
BOOTSTRAP_ORG_NAME="Skyline Communities" \
BOOTSTRAP_ORG_SLUG="skyline" \
BOOTSTRAP_PROPERTY_NAME="Skyline Residency" \
BOOTSTRAP_ADMIN_NAME="Ananya Rao" \
BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
BOOTSTRAP_ADMIN_PASSWORD="<strong-password>" \
railway run --service <backend-service-name> python -m app.bootstrap
```

Record the printed **property join code**. Residents register at `/register` using that join code and remain unverified until the society admin verifies them under **Inventory → Resident accounts**.

---

## 5. Background workers (Railway Cron Services)

Deploy workers as **Railway Cron Services** (not long-running web servers) using the same `/backend` root directory, `Dockerfile`, and backend environment variables (`ENVIRONMENT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `ALLOWED_HOSTS`, `APP_PUBLIC_URL`, `SMTP_*`):

| Worker | Start Command | Recommended Railway Schedule | Purpose |
| :--- | :--- | :--- | :--- |
| **Expiry & overstay** | `python -m app.workers.expiry` | `*/5 * * * *` (Railway minimum cron interval) | Expires stale QR passes, reservations, and pending invitations; flags overstays; purges `realtime_events` past `EVENT_RETENTION_DAYS`; records `expiry` heartbeat |
| **Email outbox** | `python -m app.workers.notifications` | `*/5 * * * *` | Drains `PENDING` email rows using `FOR UPDATE SKIP LOCKED`, retries SMTP with backoff, marks `SENT`/`SKIPPED`/`FAILED`, records `notifications` heartbeat |
| **Worker health** | `python -m app.workers.health` | `*/10 * * * *` | Exits non-zero if any email is `FAILED`, `PENDING` exceeds `OUTBOX_STALE_MINUTES`, or a worker heartbeat exceeds `WORKER_STALE_MINUTES` |

> **Note:** Railway native Cron services have a 5-minute minimum interval (`*/5 * * * *`). Set `WORKER_STALE_MINUTES=10` and `OUTBOX_STALE_MINUTES=15` on the backend and worker services so normal 5-minute cron jitter does not trigger false stale alerts.

---

## 6. Healthcheck & production acceptance checklist

### 6.1 Endpoint verification

```bash
# Liveness (no DB dependency)
curl -fsS https://<backend-domain>/health

# Readiness (verifies PostgreSQL SELECT 1)
curl -fsS https://<backend-domain>/ready

# Prometheus metrics (requires METRICS_TOKEN in production)
curl -fsS -H "Authorization: Bearer <METRICS_TOKEN>" https://<backend-domain>/metrics
```

### 6.2 Production acceptance checklist

1. `GET /health` returns HTTP `200` `{"status":"ok",...}`.
2. `GET /ready` returns HTTP `200` `{"status":"ready","database":"ok"}`.
3. `GET /metrics` without `Authorization` returns HTTP `401` (or `403` if unset); with `Bearer <METRICS_TOKEN>` returns Prometheus text.
4. `GET /docs` and `/api/v1/openapi.json` return `404` (unless `ENABLE_API_DOCS=true`).
5. Sign in as the bootstrapped admin in the frontend; refresh the browser (`F5`) and verify session restoration succeeds via `/api/v1/auth/refresh`.
6. Sign out and verify `parkvanta_refresh` cookie is cleared and refresh fails with `401`.
7. Test password reset end-to-end with a real email inbox via SMTP.
8. Confirm one full visitor lifecycle: register resident via join code → verify resident → create & approve invitation → inspect `/pass/<token>` → guard verify → authorize entry → confirm entry → offline exit queue → reconnect & reconcile → confirm audit log entry.
9. Run `python -m app.workers.expiry`, `python -m app.workers.notifications`, `python -m app.workers.health`, and `python -m app.pilot_preflight` (must exit `0`).
10. Inspect built frontend assets to verify no `localhost` API URL is present.

---

## 7. Backup, rollback, and monitoring

### 7.1 Backups and recovery

- **PostgreSQL:** Enable Railway automated daily snapshots + PITR and test restoring into a staging database quarterly (`pg_dump` / `pg_restore`).
- **Redis:** Holds no authoritative state and can be flushed or recreated without data loss.
- **Local/Compose backup helper:** `make pilot-backup` writes `./backups/parkvanta-<UTC timestamp>.dump.gz` with 14-day retention.

### 7.2 Rollback procedure

1. **Application rollback:** In Railway, roll back the Backend API or Frontend Web service to the previous successful deployment.
2. **Database safety:** Keep schema migrations backward-compatible for at least one release; if an emergency schema rollback is strictly required, take a fresh `pg_dump` before running `alembic downgrade -1` as a one-off command.

### 7.3 Monitoring & alerts

- Ready-made Prometheus alert rules and Grafana dashboard live in `infrastructure/monitoring/prometheus-rules.yml` and `infrastructure/monitoring/grafana-dashboard.json`.
- Page on: `/ready` returning `503`, API 5xx > 2%, `parkvanta_worker_up == 0`, `parkvanta_notification_outbox_rows{status="FAILED"} > 0`, or oldest `PENDING` email exceeding `OUTBOX_STALE_MINUTES`.

---

## 8. CI/CD

`.github/workflows/ci.yml` runs on every push/PR:

```text
backend:  alembic upgrade (service Postgres) → pytest
frontend: npm ci → tsc + vite build → bundle budget
e2e:      pip + npm ci → playwright install chromium → full lifecycle test
security: ruff → bandit → pip-audit → npm audit (production and dev)
images:   docker build API + web → size budgets
```
