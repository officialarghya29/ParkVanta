#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta_assets"
export JWT_SECRET="${JWT_SECRET:-assets-only-secret-key-not-for-production}"
export ENVIRONMENT="development"
export CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
export REDIS_URL="${REDIS_URL:-redis://localhost:56379/3}"
export PYTHONUNBUFFERED=1

cd "$ROOT/backend"
"$ROOT/.venv/bin/python" - <<'PY'
import psycopg

with psycopg.connect(
    "postgresql://parkvanta:parkvanta@localhost:55432/postgres", autocommit=True
) as connection:
    connection.execute("DROP DATABASE IF EXISTS parkvanta_assets WITH (FORCE)")
    connection.execute("CREATE DATABASE parkvanta_assets")
PY
"$ROOT/.venv/bin/alembic" upgrade head >/dev/null
"$ROOT/.venv/bin/python" -m app.seed >/dev/null

"$ROOT/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8091 --log-level warning &
API_PID=$!

cd "$ROOT/apps/web"
VITE_API_BASE_URL="http://127.0.0.1:8091/api/v1" \
  npm run dev -- --host 127.0.0.1 --port 5173 --strictPort >/tmp/parkvanta-assets-vite.log 2>&1 &
WEB_PID=$!

cleanup() {
  kill "$WEB_PID" "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 80); do
  if curl -fsS "http://127.0.0.1:8091/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:5173" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:8091/health" >/dev/null
curl -fsS "http://127.0.0.1:5173" >/dev/null

node "$ROOT/apps/web/scripts/capture-assets.mjs"

"$ROOT/.venv/bin/python" - "$ROOT" <<'PY'
import sys
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1])
for image_path in sorted((root / "docs/assets").glob("screenshot-*.png")):
    image = Image.open(image_path)
    if image.width > 1800:
        height = round(image.height * 1800 / image.width)
        image = image.resize((1800, height), Image.LANCZOS)
    image.save(image_path, optimize=True)
    print(f"optimized {image_path.name} → {image.width}×{image.height}")
PY
