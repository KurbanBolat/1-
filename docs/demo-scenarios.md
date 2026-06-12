# StayPilot Demo Scenarios

Use this guide for buyer demos, hotel partner reviews, and technical walkthroughs.

## Demo Entry Points

Local URLs:
- Demo guide: `http://localhost:3000/demo?lang=ru&currency=KZT`
- Guest app: `http://localhost:3000/?lang=ru&currency=KZT&city=Dubai&guests=2`
- AI concierge: `http://localhost:3000/?lang=ru&currency=KZT&city=Dubai&guests=2#ai`
- Hotel sales page: `http://localhost:3000/for-hotels?lang=ru&currency=KZT`
- Partner login: `http://localhost:3000/login?lang=ru&currency=KZT`
- Refund policy: `http://localhost:3000/refund-policy?lang=ru&currency=KZT`

Seed polished local demo data before a buyer session:
```bash
cd backend
python scripts/seed_demo_data.py --reset
```

This creates stable Dubai showcase data:
- `Address Beach Resort`
- `Jumeirah Al Naseem`
- `Taj Dubai`
- `SLS Dubai Hotel & Residences`

Each demo property gets room types, cover/gallery photos, room availability signals, restaurants, room-service menu items, reservations, payment states, and sample in-stay service requests.

## 10-Minute Buyer Script

1. Hotel value page, 0-2 minutes:
   Open `/for-hotels` and explain that StayPilot is not only a listing UI. It covers guest search, room availability, booking, payment handoff, guest account, in-stay services, and manager operations.

2. Guest search, 2-4 minutes:
   Open the Dubai guest demo. Show the catalog, cards, filters, and AI concierge. Use the prompt: `Нужен отель в Дубае на 3 ночи, 2 взрослых`.

3. Available rooms, 4-6 minutes:
   Open a property from the catalog. Show room-type availability, available windows, room counts, nightly price, and checkout CTA. Emphasize that this replaced the abstract blocked-date calendar.

4. Checkout and payment, 6-8 minutes:
   Continue to checkout, fill guest details, and complete the mock payment flow. The payment screen should clearly show demo/mock mode until a real provider is connected.

5. Guest account and in-stay, 8-9 minutes:
   Open the success/account flow. Show reservation status, payment status, access token flow, room service, restaurant booking, and service status updates.

6. Manager workspace, 9-10 minutes:
   Open partner login and manager workspace. Show reservations, room inventory, availability, restaurants, room-service orders, and operational command center.

## Local Partner Login

For local QA only, Playwright and dev environments can seed an admin user when:
- `SEED_ADMIN_ENABLED=true`
- `SEED_ADMIN_EMAIL=admin@local.dev`
- `SEED_ADMIN_PASSWORD=Admin12345!`

Do not expose these credentials in production. For hosted demos, create dedicated partner credentials and rotate them after each buyer session.

## What To Prove

- Search and AI concierge use the same guest context.
- Room availability is shown as bookable room types, not only blocked dates.
- Checkout can create a reservation and hand off to payment status.
- Payment mode is explicit: `mock` auto-confirms for demos; `manual`, `stripe`, and `kaspi` wait for webhook finalization.
- Guest account can show confirmed booking and in-stay services.
- Manager workspace controls reservations, inventory, availability, restaurants, and service orders.
- Public pages cover hotel sales, privacy, terms, refund policy, contacts, and demo guide.
- Pre-production gate can require catalog, room availability, menu, and restaurant data through `--require-catalog --require-instay`.
- CI, backend tests, frontend typecheck/build, and targeted e2e pass.

## Demo Reset Notes

- Use a fresh browser profile or clear local storage if guest state looks stale.
- If Next dev CSS breaks after `npm run build`, restart `npm run dev`.
- If room availability is sparse, run `python scripts/seed_demo_data.py --reset`.
- Keep `AI_CONCIERGE_MODE=stub` for sale demos unless live GPT has been reviewed.
