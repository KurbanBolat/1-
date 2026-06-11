# Production Runbook

## Services
- Backend: FastAPI, SQLAlchemy, Alembic.
- Frontend: Next.js App Router.
- Database: Postgres 16.
- Background jobs: in-process reservation expiration worker.

## Required Environment
Copy `.env.production.example` to `.env.production` and replace all placeholder secrets.

Minimum required values:
- `SECRET_KEY`: 64+ random characters.
- `POSTGRES_PASSWORD`: strong database password.
- `DATABASE_URL`: `postgresql+psycopg://...`.
- `CORS_ORIGINS`: public frontend origin, no wildcard.
- `NEXT_PUBLIC_API_URL`: public backend origin.
- `AUTH_COOKIE_SECURE=true`.
- `CSRF_ENFORCE=true`.
- `PAYMENT_WEBHOOK_SECRET`: HMAC secret for `/payments/webhook`.
- `SENTRY_ENVIRONMENT=production`.

See `docs/production-secrets.md` for the full checklist and secret generation commands.

OpenAI is optional at deploy time. If `OPENAI_API_KEY` is empty or quota is exhausted, concierge endpoints use deterministic fallback mode.

## Build And Run
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

The compose file starts:
1. `postgres`
2. `migrate` running `alembic upgrade head`
3. `backend`
4. `frontend`

## Health Checks
- Backend liveness: `GET /health/live`
- Backend readiness: `GET /health/ready`
- Basic legacy health: `GET /health`
- Admin ops status: `GET /ops/status`
- Admin metrics: `GET /ops/metrics`

Readiness checks database connectivity and returns HTTP 503 if the database is unavailable. See `docs/observability.md` for logs, request ids, Sentry, and ops endpoints.

## Database Migrations
Run manually when needed:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

Local check against SQLite:
```bash
cd backend
set DATABASE_URL=sqlite:///../.tmp/alembic-prod-check.db
python -m alembic upgrade head
```

## Backups
Before every deploy, create a database backup:
```bash
python scripts/db_maintenance.py backup --env-file .env.production
```

See `docs/backup-restore.md` for restore steps, media volume backup, and retention.

## Security Gates
When `SENTRY_ENVIRONMENT=production`, startup fails unless:
- `AUTH_COOKIE_SECURE=true`
- `CSRF_ENFORCE=true`
- `CORS_ORIGINS` does not contain `*`
- `PAYMENT_WEBHOOK_SECRET` is set
- `SECRET_KEY` is strong

## Release Gate
Before deploying, the GitHub Actions CI workflow should be green:
- backend compile, tests, and clean Alembic migration check
- frontend typecheck and production build
- production env validation
- production compose config validation

Run the manual E2E smoke workflow before major releases or large user-flow changes.

Local preflight:
```bash
python scripts/check_production_env.py --file .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

## Deployment Notes
- Use `docs/staging-deploy.md` for the first VPS rollout and rollback flow.
- Put TLS and domain routing in a reverse proxy or platform load balancer.
- Route frontend domain to port 3000.
- Route backend API domain to port 8000.
- Preserve `backend_media` and `postgres_data` volumes across deploys.
- Keep `/payments/webhook` reachable from the payment provider.
