#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta_bench"
export JWT_SECRET="${JWT_SECRET:-benchmark-only-secret-key-not-for-production}"
export ENVIRONMENT="development"
export REDIS_URL="${REDIS_URL:-redis://localhost:56379/2}"
export PYTHONUNBUFFERED=1

mkdir -p "$ROOT/docs/benchmarks"
cd "$ROOT/backend"

"$ROOT/.venv/bin/python" - <<'PY'
import psycopg

with psycopg.connect(
    "postgresql://parkvanta:parkvanta@localhost:55432/postgres", autocommit=True
) as connection:
    connection.execute("DROP DATABASE IF EXISTS parkvanta_bench WITH (FORCE)")
    connection.execute("CREATE DATABASE parkvanta_bench")
PY

"$ROOT/.venv/bin/alembic" upgrade head >/dev/null
"$ROOT/.venv/bin/python" -m app.seed >/dev/null

"$ROOT/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8092 --log-level warning &
API_PID=$!
cleanup() {
  kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:8092/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:8092/health" >/dev/null

"$ROOT/.venv/bin/python" "$ROOT/scripts/load_test.py" \
  --base-url "http://127.0.0.1:8092/api/v1" \
  --concurrency 20 \
  --duration 20 \
  --output "$ROOT/docs/benchmarks/local-20c.json"
