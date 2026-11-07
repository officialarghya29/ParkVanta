#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta_e2e"
export JWT_SECRET="${JWT_SECRET:-e2e-only-secret-key-please-do-not-reuse-in-production}"
export ENVIRONMENT="development"
export CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
export REDIS_URL="${REDIS_URL:-redis://localhost:56379/0}"
export PYTHONUNBUFFERED=1

cd "$ROOT/backend"

"$ROOT/.venv/bin/python" - <<'PY'
import psycopg

with psycopg.connect(
    "postgresql://parkvanta:parkvanta@localhost:55432/postgres", autocommit=True
) as connection:
    connection.execute("DROP DATABASE IF EXISTS parkvanta_e2e WITH (FORCE)")
    connection.execute("CREATE DATABASE parkvanta_e2e")
PY

"$ROOT/.venv/bin/alembic" upgrade head
"$ROOT/.venv/bin/python" -m app.seed

exec "$ROOT/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8091 --log-level warning
