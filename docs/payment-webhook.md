# Payment Webhook Contract

Endpoint:

```http
POST /payments/webhook
Content-Type: application/json
X-StayPilot-Signature: sha256=<hex_hmac_sha256>
```

The signature is `HMAC_SHA256(raw_request_body, PAYMENT_WEBHOOK_SECRET)`.
If `PAYMENT_WEBHOOK_SECRET` is empty, signature validation is skipped. Production startup refuses an empty secret.

## Normalized Payload
```json
{
  "provider": "kaspi",
  "event_id": "provider-event-id-123",
  "reservation_id": 42,
  "status": "paid",
  "amount": 186000,
  "currency": "KZT",
  "method": "kaspi",
  "idempotency_key": "checkout-attempt-id-123"
}
```

Fields:
- `provider`: `mock`, `stripe`, `kaspi`, or `manual`.
- `event_id`: provider event id. The pair `provider + event_id` is unique and idempotent.
- `reservation_id`: StayPilot reservation id.
- `status`: `pending`, `paid`, or `failed`.
- `amount`: optional, but recommended. If supplied, it must match the reservation payment amount.
- `currency`: optional, defaults to `KZT`. If supplied, it must match the stored payment currency.
- `method`: optional payment method, one of `card`, `kaspi`, `apple_pay`.
- `idempotency_key`: optional checkout attempt key. If supplied, the webhook updates that attempt.

## Behavior
- Duplicate webhook events return `duplicate: true` and do not mutate state again.
- `paid` moves a `draft` reservation to `pending_payment`, then to `confirmed`.
- `failed` marks the payment attempt failed. It does not override an already `paid` or `refunded` payment.
- Amount or currency mismatch is rejected with HTTP 409 and a rejected webhook event is recorded.

## Example Signature
```bash
BODY='{"provider":"kaspi","event_id":"evt_12345678","reservation_id":42,"status":"paid","amount":186000,"currency":"KZT","method":"kaspi","idempotency_key":"idem_12345678"}'
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST "$API_URL/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "X-StayPilot-Signature: sha256=$SIG" \
  -d "$BODY"
```
