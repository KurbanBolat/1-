# StayPilot Seller Pitch

## One-Liner

StayPilot is a booking-style hotel platform with AI concierge, room inventory, checkout, guest account, in-stay services, partner operations, CI, and production deployment scaffolding.

## Best Buyer Fit

- Boutique hotel groups that want more direct bookings.
- Travel or hospitality startups that need a product base instead of a static mockup.
- Agencies selling hotel digital transformation packages.
- Software buyers looking for a Next.js/FastAPI booking app with tested workflows.

## What Is Already Built

- Guest app with city search, catalog, AI concierge UX, and localized KZT/USD experience.
- Stay detail pages with room-type availability, available windows, prices, and checkout handoff.
- Reservation checkout, payment status flow, success page, and guest account.
- Partner manager workspace for listings, rooms, availability, reservations, restaurants, menu items, and service orders.
- In-stay concierge flows for room service, table booking, and request status.
- Public sales and due-diligence pages: `/for-hotels`, `/demo`, `/privacy`, `/terms`, `/refund-policy`, `/contacts`.
- Backend services with migrations, health checks, environment validation, and pre-production gate.
- CI on GitHub Actions plus backend tests, frontend typecheck/build, and e2e smoke coverage.

## What Is Intentionally Stubbed

- Live OpenAI GPT mode is disabled by default. Current safe mode is `AI_CONCIERGE_MODE=stub`.
- Real payment provider credentials are not included. Demo mode uses `PAYMENT_PROVIDER=mock` or `manual`.
- Operator legal details, production support inboxes, domain, TLS, hosted database, and DPA must be added by the buyer.

## Price Framing

Position as a working MVP/product base, not a landing page. The strongest selling points are:
- integrated guest and hotel manager flows;
- room inventory and availability logic;
- tested booking/payment/account paths;
- production scaffolding and buyer-facing docs;
- clear OpenAI/payment integration surface.

For a codebase sale without hosted operations, the value is lower than a revenue-generating SaaS but higher than a design prototype. For a bundled sale with setup, demo data, deployment help, and one or two hotel pilots, price can be materially higher.

## Buyer Demo Checklist

Before every demo:
- `git status --short` is clean.
- Backend health returns 200.
- Frontend `/demo?lang=ru&currency=KZT` opens with CSS.
- `AI_CONCIERGE_MODE=stub`.
- `PAYMENT_PROVIDER=mock` or clear manual demo mode.
- Partner credentials are created for the session and not shared publicly.
- Run at least the targeted e2e:
  ```bash
  cd frontend
  npm run test:e2e -- --grep "hotel landing|public legal|demo guide"
  ```

## Next Upsell Work

- Connect Stripe/Kaspi and provider webhooks.
- Enable live GPT with tool calling, guardrails, and conversation evals.
- Add hosted staging with domain/TLS and real Postgres.
- Add hotel onboarding workflow and import/export tools.
- Add signed DPA, privacy review, and real operator legal pages.
