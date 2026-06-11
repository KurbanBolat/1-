# Observability

## Health Endpoints
- `GET /health`: legacy basic health.
- `GET /health/live`: process liveness. Use for container liveness checks.
- `GET /health/ready`: readiness with database check. Use for load balancer readiness.

Readiness response:
```json
{
  "status": "ready",
  "checks": {
    "database": "ok"
  }
}
```

## Request Tracing
Every request receives an `x-request-id` response header.

If the client sends `x-request-id`, the backend echoes it. Otherwise the backend generates one. The same request id is included in JSON logs and sent to Sentry as a request tag/context when `SENTRY_DSN` is configured.

## Logs
Backend logs are structured JSON on stdout/stderr. Important fields:
- `timestamp`
- `level`
- `logger`
- `message`
- `request_id`
- `method`
- `path`
- `status_code`
- `latency_ms`
- `exception`

Set log level with:
```dotenv
OBSERVABILITY_LOG_LEVEL=INFO
```

## Admin Ops Endpoints
These require an admin user.

```http
GET /ops/status
GET /ops/metrics
```

`/ops/status` reports safe subsystem state:
- database
- CORS
- secure auth cookie
- CSRF
- payment webhook HMAC secret
- OpenAI mode
- Sentry
- notification channels
- alert thresholds

Overall status:
- `ready`: no failing or warning components
- `degraded`: warnings exist, but required components are not failing
- `failed`: at least one failing component exists

`/ops/metrics` reports payment and communication failure rates for the configured window.

## Alerts
Configure thresholds:
```dotenv
OBSERVABILITY_METRICS_WINDOW_MINUTES=60
OBSERVABILITY_ALERT_PAYMENT_FAIL_RATE=0.2
OBSERVABILITY_ALERT_COMMUNICATION_FAIL_RATE=0.2
```

These thresholds are surfaced in `/ops/status` and `/ops/metrics`. They do not send external alerts by themselves; wire them to Sentry, uptime checks, or external monitoring if needed.

## Sentry
Sentry is optional. Enable it with:
```dotenv
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.0
```

Keep `SENTRY_TRACES_SAMPLE_RATE` low at first. Increase only when tracing is needed and volume is understood.

## Smoke Check
After deploy:
```bash
python scripts/smoke_production.py \
  --backend-url https://api-staging.example.com \
  --frontend-url https://staging.example.com
```

The smoke script checks backend liveness, readiness, and frontend HTML.

With an admin token it also checks `/ops/status`:
```bash
python scripts/smoke_production.py \
  --backend-url https://api-staging.example.com \
  --frontend-url https://staging.example.com \
  --admin-token "$ADMIN_TOKEN"
```
