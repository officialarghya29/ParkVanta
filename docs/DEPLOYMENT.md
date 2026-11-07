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
| `SEED_PASSWORD` | dev only | Demo account password |

Secrets belong in a managed secret store, never in the image or repository.

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
4. Deploy the API, then the web assets.
5. Hit `/health` and `/ready`; confirm a login and one gate verification.
6. Keep the previous image tag for rollback.

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
pip install → alembic upgrade (service Postgres) → pytest
npm ci → npm run build
```

Deployment is intentionally not automatic yet; wire the image build and environment promotion after a pilot
environment exists.

## 9. Pilot checklist

- One property, one gate, 2–4 guards, 10–20 visitor bays.
- Real resident accounts, verified by the society office.
- Printed fallback procedure for manual override.
- Measure: verification time, scan success rate, allocation accuracy, double-allocation incidents (must be zero),
  overstay handling and guard feedback.
