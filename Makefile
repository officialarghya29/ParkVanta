.PHONY: help install dev api migrate seed test test-e2e build web-install

help:
	@echo "ParkVanta"
	@echo "  make install     Create .venv and install backend dependencies"
	@echo "  make migrate     Apply Alembic migrations"
	@echo "  make seed        Load the demo society and accounts"
	@echo "  make api         Run the API at http://localhost:8080"
	@echo "  make web         Run the web app at http://localhost:5173"
	@echo "  make test        Run the backend test suite"
	@echo "  make test-e2e    Run the Playwright visitor lifecycle test"
	@echo "  make up          Start Postgres + Redis via Docker Compose"

install:
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r backend/requirements.txt

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

build:
	cd apps/web && npm run build
