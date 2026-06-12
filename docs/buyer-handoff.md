# Buyer Handoff Package

This file is the short handoff guide for a buyer, hotel partner, or technical reviewer.

## Product Scope

StayPilot is a booking-style hotel app with:
- guest search and listing pages;
- room-type availability instead of an abstract blocked-date calendar;
- reservation checkout and payment-status flow;
- guest account with booking and in-stay services;
- partner manager workspace for reservations, rooms, availability, catalog, restaurants, and service orders;
- AI concierge UX with deterministic stub mode enabled by default;
- production deployment scaffolding with Postgres, Alembic, Docker Compose, health checks, and CI.

## Demo URLs

Local development:
- Guest app: `http://localhost:3000/?lang=ru&currency=KZT&city=Dubai&guests=2`
- Demo guide: `http://localhost:3000/demo?lang=ru&currency=KZT`
- Hotel sales page: `http://localhost:3000/for-hotels?lang=ru&currency=KZT`
- Privacy policy: `http://localhost:3000/privacy?lang=ru&currency=KZT`
- Terms: `http://localhost:3000/terms?lang=ru&currency=KZT`
- Refund policy: `http://localhost:3000/refund-policy?lang=ru&currency=KZT`
- Contacts: `http://localhost:3000/contacts?lang=ru&currency=KZT`
- Partner login: `http://localhost:3000/login?lang=ru&currency=KZT`
- Backend docs: `http://localhost:8000/docs`
- Readiness: `http://localhost:8000/health/ready`

## Current Production Modes

OpenAI live mode is intentionally disabled for this package:
- `AI_CONCIERGE_MODE=stub`
- `OPENAI_API_KEY=` empty

The concierge remains usable through deterministic booking, search, restaurant, room-service, and fallback logic. To enable live GPT later, set `AI_CONCIERGE_MODE=live`, add `OPENAI_API_KEY`, and re-run the pre-production gate.

Payments are demo-first by default:
- `PAYMENT_PROVIDER=mock`
- `NEXT_PUBLIC_PAYMENT_MODE=mock`

For a real hotel deployment, switch provider mode to `manual`, `stripe`, or `kaspi`, configure provider credentials, and connect the provider callback to `POST /payments/webhook` using the normalized contract in `docs/payment-webhook.md`.

## What To Review Before Buying

Run:
```bash
python -m compileall backend/app backend/tests backend/alembic
cd backend && python -m pytest -q
cd ../frontend && npm run typecheck && npm run build && npm run test:e2e
```

Check:
- `docs/production.md`
- `docs/production-secrets.md`
- `docs/staging-deploy.md`
- `docs/payment-webhook.md`
- `docs/preprod-qa.md`
- `docs/demo-scenarios.md`
- `docs/seller-pitch.md`

## Assets Included

- Source code for backend, frontend, deployment scripts, and docs.
- Production Docker Compose file.
- Alembic migrations and startup compatibility bootstrap.
- Environment validators and pre-production gate scripts.
- Local E2E suite covering search, booking, payment, account, manager, restaurant booking, room service, and hotel sales page.
- GitHub Actions workflow for CI.
- Public legal/contact page templates for privacy, terms, refund policy, and support contacts.
- Public demo guide plus buyer demo and seller pitch documentation.

## Not Included Yet

- Live OpenAI key and live GPT production prompt tuning.
- Signed Stripe/Kaspi production account configuration.
- Domain, TLS, reverse proxy, and hosted database credentials.
- Final legal counsel review, real operator legal details, and data-processing agreement.

## Go-Live Sequence

1. Create `.env.production` from `.env.production.example`.
2. Replace all placeholders and keep `AI_CONCIERGE_MODE=stub`.
3. Choose `PAYMENT_PROVIDER`.
4. Validate env:
   ```bash
   python scripts/check_production_env.py --file .env.production
   ```
5. Start staging:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
   ```
6. Run migrations and health checks.
7. Run the pre-production gate.
8. Replace legal/contact placeholders with the operator's real details and complete legal review.
9. Connect domain/TLS and payment provider webhook.
10. Run one full booking and in-stay service smoke test before opening traffic.
