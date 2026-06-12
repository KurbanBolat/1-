# Pre-Production QA Gate

Use this gate before staging promotion and before production launch.

## Automated Gate
Local/static gate against the example env:
```bash
python scripts/preprod_gate.py \
  --env-file .env.production.example \
  --allow-placeholders \
  --backend-url http://127.0.0.1:8000 \
  --frontend-url http://127.0.0.1:3000 \
  --require-catalog \
  --require-instay
```

Full staging gate:
```bash
python scripts/preprod_gate.py \
  --env-file .env.production \
  --backend-url https://api-staging.example.com \
  --frontend-url https://staging.example.com \
  --admin-token "$ADMIN_TOKEN" \
  --require-catalog \
  --require-instay \
  --db-check
```

Full local engineering gate:
```bash
python scripts/preprod_gate.py \
  --env-file .env.production.example \
  --allow-placeholders \
  --backend-url http://127.0.0.1:8000 \
  --frontend-url http://127.0.0.1:3000 \
  --require-catalog \
  --require-instay \
  --local-checks
```

For buyer demos, run `cd backend && python scripts/seed_demo_data.py --reset` first so the catalog smoke has stable Dubai properties, room inventory, menus, and restaurants.

Manual Playwright E2E:
```bash
cd frontend
npm run test:e2e
```

## Payment Webhook Probe
Use a disposable staging reservation. `failed` is safer than `paid` for a first probe.

```bash
python scripts/payment_webhook_probe.py \
  --api-url https://api-staging.example.com \
  --env-file .env.production \
  --reservation-id <STAGING_RESERVATION_ID> \
  --status failed \
  --method kaspi \
  --yes
```

Expected:
- HTTP 200
- `process_status=processed`
- duplicate run with the same `--event-id` returns `duplicate=true`

Do not run `--status paid` against a real user reservation unless the payment provider event is real.

## Required Manual User Flows
Run these on staging:
- Home search in RU/KZT and EN/USD.
- Stay details page with available rooms.
- Booking flow through checkout success.
- Account page with reservation lookup.
- Manager login.
- Manager reservations dashboard.
- Manager notification read state.
- In-stay room service: guest order -> manager accepts -> guest sees updated status.
- In-stay restaurant booking: guest asks concierge -> manager confirms.
- AI concierge rail: search intent, room filters, booking-ready handoff.
- In-stay AI concierge: menu/status/restaurant questions.
- 404/validation cases show structured errors, not blank pages.
- Mobile viewport: home, stay details, checkout, in-stay concierge.

## Release Criteria
All must be true:
- GitHub Actions CI green.
- `scripts/preprod_gate.py` passes for staging.
- Database backup completed before deploy.
- Smoke check passes after deploy.
- `/ops/status` is `ready` or only has accepted non-blocking `degraded` items.
- Payment webhook probe passes on a disposable staging reservation.
- No backend startup security gate errors.
- No new Sentry errors during the QA window.

## Blockers
Do not promote if:
- `/health/ready` fails.
- `/ops/status` is `failed`.
- Webhook signature probe fails.
- Checkout cannot reach success.
- Manager cannot see or act on reservations/in-stay orders.
- Launch scope explicitly requires live GPT, but `AI_CONCIERGE_MODE=live` cannot pass with a valid `OPENAI_API_KEY`.
