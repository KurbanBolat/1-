# Backup And Restore Runbook

This runbook covers production/staging data protection for the Docker Compose deployment.

## What Must Be Backed Up
- Postgres database: reservations, users, payments, inventory, concierge state, ops data.
- `backend_media` Docker volume: listing images and uploaded media.
- `.env.production`: keep a secure offline copy. Do not commit it.

## Database Backup
Run from the project root on the server:
```bash
python scripts/db_maintenance.py backup --env-file .env.production
```

Default output:
```text
backups/staypilot_YYYYMMDD_HHMMSS.sql.gz
```

List backups:
```bash
python scripts/db_maintenance.py list
```

Check database connectivity:
```bash
python scripts/db_maintenance.py check --env-file .env.production
```

## Database Restore
Restores are destructive. Confirm the target environment and backup file first.

```bash
python scripts/db_maintenance.py restore backups/staypilot_YYYYMMDD_HHMMSS.sql.gz \
  --env-file .env.production \
  --yes
```

After restore:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
python scripts/smoke_production.py \
  --backend-url https://api-staging.example.com \
  --frontend-url https://staging.example.com \
  --admin-token "$ADMIN_TOKEN"
```

## Media Volume Backup
Compose names the media volume `staypilot_backend_media`.

Backup:
```bash
mkdir -p backups
docker run --rm \
  -v staypilot_backend_media:/data:ro \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/backend_media_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .
```

Restore into an existing media volume:
```bash
docker run --rm \
  -v staypilot_backend_media:/data \
  -v "$PWD/backups":/backup \
  alpine sh -c 'cd /data && tar xzf /backup/backend_media_YYYYMMDD_HHMMSS.tar.gz'
```

## Before Every Deploy
```bash
python scripts/check_production_env.py --file .env.production
python scripts/db_maintenance.py backup --env-file .env.production
docker run --rm \
  -v staypilot_backend_media:/data:ro \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/backend_media_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

## Retention
Minimum practical retention:
- Keep the latest 7 daily backups.
- Keep one weekly backup for 4 weeks.
- Copy production backups off the server.

The local `backups/` directory is ignored by git. It is not a durable backup location by itself.

## Restore Drill
Before production launch, run one full restore into staging:
1. Create a staging backup.
2. Restore it into a fresh staging database volume.
3. Run migrations.
4. Run smoke checks.
5. Open the app and verify booking, checkout success, manager dashboard, and in-stay concierge history.
