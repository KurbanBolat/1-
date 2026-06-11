# Staging Deploy Runbook

This runbook is for the first VPS or staging server deployment. Use Ubuntu LTS unless the hosting provider has a stronger default.

## 1. Server Prerequisites
- Ubuntu 22.04/24.04 VPS with at least 2 vCPU, 4 GB RAM, and 30 GB disk.
- DNS records for frontend and API, for example `staging.example.com` and `api-staging.example.com`.
- Docker Engine installed from Docker's official Linux repository: https://docs.docker.com/engine/install/ubuntu/
- Docker Compose plugin installed from Docker's official Linux instructions: https://docs.docker.com/compose/install/linux/
- Ports opened for SSH and HTTP/HTTPS. Keep direct `3000`/`8000` access private unless this is a temporary staging-only server.

Verify Docker:
```bash
docker --version
docker compose version
docker info
```

## 2. Copy Project To Server
Use a stable directory:
```bash
sudo mkdir -p /opt/staypilot
sudo chown "$USER":"$USER" /opt/staypilot
cd /opt/staypilot
```

Copy or clone the project into `/opt/staypilot`. The directory should contain `docker-compose.prod.yml`, `backend`, `frontend`, `scripts`, and `docs`.

## 3. Create `.env.production`
```bash
cp .env.production.example .env.production
```

Generate secrets:
```bash
python - <<'PY'
import secrets
print("SECRET_KEY=" + secrets.token_urlsafe(64))
print("POSTGRES_PASSWORD=" + secrets.token_urlsafe(32))
print("PAYMENT_WEBHOOK_SECRET=" + secrets.token_urlsafe(48))
PY
```

Replace placeholders in `.env.production`:
- `SECRET_KEY`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `CORS_ORIGINS`
- `NEXT_PUBLIC_API_URL`
- `CSRF_TRUSTED_ORIGINS`
- `PAYMENT_WEBHOOK_SECRET`
- optional `OPENAI_API_KEY`, `SENTRY_DSN`, `SMTP_*`, `TELEGRAM_*`

Validate:
```bash
python scripts/check_production_env.py --file .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

## 4. First Start
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

The startup order is `postgres`, `migrate`, `backend`, then `frontend`.

Inspect logs if a service is not healthy:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 postgres
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 migrate
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 frontend
```

## 5. Smoke Check
From the server or your local machine:
```bash
python scripts/smoke_production.py \
  --backend-url https://api-staging.example.com \
  --frontend-url https://staging.example.com \
  --admin-token "$ADMIN_TOKEN"
```

Temporary direct-port check on a staging-only host:
```bash
python scripts/smoke_production.py \
  --backend-url http://SERVER_IP:8000 \
  --frontend-url http://SERVER_IP:3000
```

Expected:
- backend `/health/live` returns `{"status":"ok"}`
- backend `/health/ready` returns ready with database OK
- frontend root returns HTML

After logging in as an admin, check:
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://api-staging.example.com/ops/status
```

## 6. Reverse Proxy And TLS
Use Caddy, Nginx, a cloud load balancer, or the hosting platform's proxy.

Route:
- frontend domain -> `127.0.0.1:3000`
- API domain -> `127.0.0.1:8000`

Then set:
```dotenv
CORS_ORIGINS=https://staging.example.com
CSRF_TRUSTED_ORIGINS=https://staging.example.com
NEXT_PUBLIC_API_URL=https://api-staging.example.com
AUTH_COOKIE_SECURE=true
CSRF_ENFORCE=true
```

## 7. Update Deployment
Before updating:
```bash
python scripts/check_production_env.py --file .env.production
python scripts/db_maintenance.py backup --env-file .env.production
```

Deploy new code:
```bash
git pull --ff-only
python scripts/check_production_env.py --file .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
python scripts/smoke_production.py --backend-url https://api-staging.example.com --frontend-url https://staging.example.com
```

## 8. Rollback
```bash
git checkout <previous-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
python scripts/smoke_production.py --backend-url https://api-staging.example.com --frontend-url https://staging.example.com
```

If migration rollback is required, restore the Postgres backup into a fresh database volume instead of editing tables manually.

See `docs/backup-restore.md` for database and media volume backup/restore commands.

## 9. Staging Acceptance
Before promoting to production:
- GitHub Actions CI is green.
- Manual E2E smoke workflow is green.
- Server smoke check is green.
- `scripts/preprod_gate.py` passes for staging.
- Booking, checkout success, manager dashboard, in-stay concierge, and payment webhook test event all work on staging.
- No startup security gate errors in backend logs.
