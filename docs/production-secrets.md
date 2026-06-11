# Production Secrets Checklist

Use `.env.production.example` as a template only. Never deploy with placeholder values.

## Required
- `SECRET_KEY`: 64+ random characters.
- `POSTGRES_PASSWORD`: strong database password, 16+ characters minimum.
- `DATABASE_URL`: production Postgres URL.
- `CORS_ORIGINS`: public frontend origin, comma-separated if there is more than one.
- `NEXT_PUBLIC_API_URL`: public backend API origin.
- `AUTH_COOKIE_SECURE=true`
- `CSRF_ENFORCE=true`
- `CSRF_TRUSTED_ORIGINS`: frontend origin if it is not already covered by `CORS_ORIGINS`.
- `PAYMENT_WEBHOOK_SECRET`: 32+ random characters for webhook HMAC.
- `SENTRY_ENVIRONMENT=production`

## Optional
- `OPENAI_API_KEY`: required only for live GPT concierge mode.
- `SENTRY_DSN`: required only if Sentry reporting is enabled.
- `NOTIFICATION_WEBHOOK_URL`: outbound reservation notification webhook.
- `SMTP_*`: required only when `NOTIFICATION_EMAIL_ENABLED=true`.
- `TELEGRAM_*`: required only when `NOTIFICATION_TELEGRAM_ENABLED=true`.

## Generate Local Secrets
PowerShell:
```powershell
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(64)); print('POSTGRES_PASSWORD=' + secrets.token_urlsafe(32)); print('PAYMENT_WEBHOOK_SECRET=' + secrets.token_urlsafe(48))"
```

Bash:
```bash
python - <<'PY'
import secrets
print("SECRET_KEY=" + secrets.token_urlsafe(64))
print("POSTGRES_PASSWORD=" + secrets.token_urlsafe(32))
print("PAYMENT_WEBHOOK_SECRET=" + secrets.token_urlsafe(48))
PY
```

## Validate Before Deploy
```bash
python scripts/check_production_env.py --file .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

The validator fails on placeholders, weak secrets, wildcard CORS, insecure production flags, localhost URLs, invalid ports, and missing channel secrets.
