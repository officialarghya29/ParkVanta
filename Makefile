.PHONY: help install dev api migrate seed test test-e2e load-test load-test-write build web-install lint audit pilot-backup

help:
	@echo "ParkVanta"
	@echo "  make install     Create .venv and install backend dependencies"
	@echo "  make migrate     Apply Alembic migrations"
	@echo "  make seed        Load the demo society and accounts"
	@echo "  make api         Run the API at http://localhost:8080"
	@echo "  make web         Run the web app at http://localhost:5173"
	@echo "  make test        Run the backend test suite"
	@echo "  make test-e2e    Run the Playwright visitor lifecycle test"
	@echo "  make load-test   Benchmark the read path against a fresh seeded DB"
	@echo "  make load-test-write  Benchmark gate cycles + contended allocations"
	@echo "  make lint        Run Ruff over the backend"
	@echo "  make audit       Audit Python and production Node dependencies"
	@echo "  make pilot-backup  Dump the compose PostgreSQL database with 14-day retention"
	@echo "  make up          Start Postgres + Redis via Docker Compose"

install:
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r backend/requirements-dev.txt

migrate:
	cd backend && ../.venv/bin/alembic upgrade head

seed:
	cd backend && ../.venv/bin/python -m app.seed

api:
	cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8080

web-install:
	cd apps/web && npm install

web:
	cd apps/web && npm run dev

up:
	docker compose up -d db redis

test:
	cd backend && ../.venv/bin/pytest -q

test-e2e:
	cd apps/web && npx playwright test

load-test:
	bash scripts/benchmark.sh

load-test-write:
	bash scripts/benchmark_write.sh

lint:
	.venv/bin/ruff check backend

audit:
	.venv/bin/pip-audit --progress-spinner off
	cd apps/web && npm audit --omit=dev --audit-level=high

pilot-backup:
	bash scripts/pilot_backup.sh

build:
	cd apps/web && npm run build
