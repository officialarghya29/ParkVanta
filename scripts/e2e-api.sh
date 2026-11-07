#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta_e2e"
export JWT_SECRET="${JWT_SECRET:-e2e-only-secret-key-please-do-not-reuse-in-production}"
export ENVIRONMENT="development"
export CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
export REDIS_URL="${REDIS_URL:-redis://localhost:56379/0}"
export PYTHONUNBUFFERED=1

PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(command -v python3)"
fi
ALEMBIC_BIN="${ALEMBIC_BIN:-$ROOT/.venv/bin/alembic}"
if [ ! -x "$ALEMBIC_BIN" ]; then
  ALEMBIC_BIN="$(command -v alembic)"
fi
UVICORN_BIN="${UVICORN_BIN:-$ROOT/.venv/bin/uvicorn}"
if [ ! -x "$UVICORN_BIN" ]; then
  UVICORN_BIN="$(command -v uvicorn)"
fi

cd "$ROOT/backend"

"$PYTHON_BIN" - <<'PY'
import psycopg

with psycopg.connect(
    "postgresql://parkvanta:parkvanta@localhost:55432/postgres", autocommit=True
) as connection:
    connection.execute("DROP DATABASE IF EXISTS parkvanta_e2e WITH (FORCE)")
    connection.execute("CREATE DATABASE parkvanta_e2e")
PY

"$ALEMBIC_BIN" upgrade head
"$PYTHON_BIN" -m app.seed

exec "$UVICORN_BIN" app.main:app --host 127.0.0.1 --port 8091 --log-level warning
