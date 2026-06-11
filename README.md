# StayPilot

Booking-style hotel and apartment app with AI concierge, room inventory, checkout, partner manager tools, in-stay services, notifications, and production deployment scaffolding.

## Stack
- Backend: FastAPI, SQLAlchemy, Alembic, Postgres-ready.
- Frontend: Next.js App Router, TypeScript.
- Tests: pytest, Playwright.

## Local Development
Backend:
```bash
cd backend
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

Open:
- Frontend: http://localhost:3000
- Backend docs: http://localhost:8000/docs
- Health: http://localhost:8000/health/ready

Stable PowerShell dev runner:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -CleanNext
```

Stop dev services:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -StopOnly
```

## Production
Production deployment uses Postgres and Alembic migrations.

```bash
copy .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

Run migrations manually:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

Read:
- `docs/production.md`
- `docs/production-secrets.md`
- `docs/staging-deploy.md`
- `docs/observability.md`
- `docs/backup-restore.md`
- `docs/preprod-qa.md`
- `docs/payment-webhook.md`

## Checks
Backend:
```bash
cd backend
python -m pytest -q
```

Frontend:
```bash
cd frontend
npm run typecheck
npm run build
npm run test:e2e
```

CI:
```bash
python scripts/check_production_env.py --file .env.production.example --allow-placeholders
docker compose --env-file .env.production.example -f docker-compose.prod.yml config
```

GitHub Actions runs backend tests, a clean Alembic migration check, frontend typecheck/build, production env validation, production compose validation, and script compile checks on push/PR. E2E smoke is available through manual workflow dispatch.

Pre-production gate against a running environment:
```bash
python scripts/preprod_gate.py --env-file .env.production.example --allow-placeholders --backend-url http://127.0.0.1:8000 --frontend-url http://127.0.0.1:3000
```

## Notes
- OpenAI is optional at runtime. If `OPENAI_API_KEY` is missing or quota is exhausted, the concierge falls back to deterministic logic.
- Real payment providers should call `POST /payments/webhook` using the normalized contract in `docs/payment-webhook.md`.
- Production startup enforces secure cookies, CSRF, non-wildcard CORS, strong `SECRET_KEY`, and `PAYMENT_WEBHOOK_SECRET`.
