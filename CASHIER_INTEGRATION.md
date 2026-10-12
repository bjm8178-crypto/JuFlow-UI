# JuFlow cashier sales contract

The cashier app is a separate future project. This package implements the admin
website and a Python/SQLite receiver for completed cashier transactions.

## Run the local admin service

Use Python 3.10+ (standard library only):

```bash
python server.py
```

Open http://localhost:8000. Do not use `python -m http.server` for sales: that
command only serves files and cannot receive transactions.

The service binds to 127.0.0.1 for local development. This is not a deployment or
an authenticated admin system. A real cashier device on another phone/computer
cannot connect until you deploy an authenticated HTTPS backend or implement an
appropriate secured LAN setup. Do not expose this prototype publicly.

## Completed-sale event

When the cashier presses + on Pork Paksiw, only update the cashier's draft cart.
After Submit successfully completes payment, send ONE transaction containing
ALL cart lines. The admin does not calculate sales from unsubmitted cart clicks
or uncompleted delivery orders.

```
POST /api/cashier/sales
Content-Type: application/json
Authorization: Bearer <cashier API token>
```

The local service creates `.cashier-token` on first run. Keep this secret on the
cashier backend/trusted device, not in an admin HTML file, a public repository,
or an untrusted browser application. The file cannot be fetched over this server.

```json
{
  "transaction_id": "cashier-01-unique-sale-0001",
  "device_id": "cashier-01",
  "sold_at": "2026-10-03T18:00:00+08:00",
  "status": "completed",
  "payment_method": "cash",
  "demo": false,
  "items": [
    {
      "product_id": "pork-paksiw",
      "name": "Pork Paksiw",
      "quantity": 2,
      "unit_price_centavos": 7500
    }
  ]
}
```

Money is integer centavos, so 7500 = PHP 75.00. The receiver computes the total;
there is no client-supplied total to trust. Reuse a stable product ID for each dish.

- `201`: Accepted, newly recorded.
- `200`, `duplicate: true`: Already accepted, same content. Do not add again.
- `409`: Same transaction ID but different content; investigate instead of retrying
  with a new ID, which could create a duplicate sale.
- `400`: Invalid event/items/date/status; correct the request.
- `401`: Missing/invalid cashier token.
- `503`: Storage temporarily unavailable; retry the identical transaction ID.

Persist a generated transaction ID and the exact payload BEFORE sending. If the
network fails, retry that same event; never regenerate a timestamp or ID for a retry.
The receiver accepts past timestamps for delayed sync. A real cashier app must
persist its outbox and synchronize it; that app is not part of this deliverable.

## Admin read model

```
GET /api/sales/summary?date=2026-10-03&demo=0
```

The website polls every 3 seconds while visible. Refreshes update:
- Incoming sales: item names, quantities, payment type, transaction total.
- Daily accumulated total, completed transaction count, items sold.
- Hourly sales, top products, cash/GCash split.
- Last seven days and month-to-selected-date totals.

Days are midnight-to-midnight Philippine time (UTC+08:00). Previous days remain
in SQLite; midnight changes the reporting date, not stored records. The Dashboard
follows today's date automatically. Sales & reports retains the date you select.
Transactions are shown by sale time; received time is also returned for late sync.
Only the latest 50 transactions are shown in the table, but totals use all records.

## Test without a cashier app

With the server running, open Sales & reports and select Test transactions.
In another terminal inside the folder run:

```bash
python send_demo_sale.py
```

This submits one Pork Paksiw sample at PHP 75. Each invocation creates a new sample
transaction. The website should update within 3 seconds. Test records are isolated
from real cashier totals and never appear on the main Dashboard.

## Deliberate current limits

No refunds/voids/discounts or receipt corrections are implemented. Do not treat
these totals as a finalized accounting ledger. The current contract records paid
food items only; delivery fee sales would need an agreed separate revenue field or
product line. Completing a sale does NOT complete a delivery. Delivery pins still
require a cashier delivery-completion event, whose backend is not implemented here.
Customer profiles/photos remain browser-local; only cashier sales use SQLite.
No cashier/rider application or cross-device customer sync was built.

Before production: real admin authentication, device-scoped credentials, HTTPS,
validated product/pricing rules, refund events, customer/photo backend storage,
and access-controlled real-time rider events.
