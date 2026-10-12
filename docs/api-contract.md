# JuFlow API Contract & Specifications

Version: 1.0.0  
Date: October 2026  
Status: Authoritative

---

## 1. General Conventions

- **Base URL**: `/api` (proxied in production via Vercel rewrite to Render backend).
- **Format**: All request bodies and JSON responses must be UTF-8 encoded `application/json`.
- **Authentication**:
  - **Browser Users (Admin, Cashier, Rider)**: Authenticate via HttpOnly, SameSite=Lax session cookie (`juflow_session`).
  - **Trusted Cashier Device**: Authenticates via static `Authorization: Bearer <CASHIER_API_TOKEN>` header.
- **Monetary Units**:
  - All monetary values are strictly represented as **integer centavos** (1 PHP = 100 centavos).
  - Floating point numbers (e.g. `150.50`) are rejected or parsed to integer centavos.
  - Fields: `price_centavos`, `subtotal_centavos`, `fee_centavos`, `total_centavos`, `cash_tendered_centavos`, `change_centavos`.
- **Dates & Timestamps**:
  - Serialized as ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - Business day timezone is `Asia/Manila` (UTC+8).
- **Identifiers**:
  - MongoDB `_id` is serialized as a 24-character hex string. API responses expose both `id` and `_id` for backward compatibility.

---

## 2. Roles and Permissions Matrix

| Resource / Action | Admin | Cashier | Rider | Unauthenticated / Device |
| :--- | :---: | :---: | :---: | :---: |
| **Auth** (login, logout, me) | Yes | Yes | Yes | Login only |
| **Users** (CRUD, reset password) | Yes | No | No | No |
| **Products & Categories** (read) | Yes | Yes | Yes | No |
| **Products & Categories** (write) | Yes | No | No | No |
| **Customers** (read / write) | Yes | Yes | Assigned only | No |
| **Orders** (create, read all) | Yes | Yes | Assigned only | No |
| **Orders** (preparation status) | Yes | Yes | No | No |
| **Deliveries** (assign rider) | Yes | Yes | No | No |
| **Deliveries** (progress: picked_up, on_the_way, arrived, awaiting_cashier_confirmation) | Yes | Yes | Assigned rider only | No |
| **Deliveries** (final completion: `completed`) | Yes | Yes (Cashier confirmation) | **NO** | No |
| **Sales** (read summary & reports) | Yes | Yes | No | No |
| **Cashier Sales** (`/api/cashier/sales`) | No | No | No | Cashier Token only |
| **Settings & Delivery Zones** (write) | Yes | No | No | No |

---

## 3. Order & Delivery Lifecycle State Machine

```
[Order Created] ──► received ──► preparing ──► ready
                                                 │
                                                 ▼ (Rider assigned)
                                              assigned
                                                 │
                                                 ▼ (Rider picked up)
                                             picked_up
                                                 │
                                                 ▼ (Rider en route)
                                             on_the_way
                                                 │
                                                 ▼ (Rider at destination)
                                              arrived
                                                 │
                                                 ▼ (Rider reports delivery)
                                    awaiting_cashier_confirmation
                                                 │
                                                 ▼ (Cashier reconciles & confirms)
                                             completed
```

- Any state prior to `completed` can transition to `cancelled` with an authorized reason.
- **Invariant**: A rider cannot mark a delivery `completed`. When a rider hands over the food, the status becomes `awaiting_cashier_confirmation`. The map pin remains until the cashier verifies payment and issues confirmation.

---

## 4. Payment Enums & Rules

- `payment_method`:
  - `'cash'`: Requires `cash_tendered_centavos >= total_centavos`. `change_centavos = cash_tendered_centavos - total_centavos`.
  - `'exact'`: `cash_tendered_centavos = total_centavos`. `change_centavos = 0`.
  - `'gcash'`: Requires non-empty `payment_reference`. Cashier verifies confirmation before final completion.
- `payment_status`:
  - `'pending'`: Order placed but payment not yet received/verified.
  - `'paid'`: Payment verified by cashier or tendered upon delivery.
  - `'refunded'`: Order cancelled/returned and funds reversed.

---

## 5. Key Endpoint Contracts

### 5.1 Orders
- `POST /api/orders`: Create an order with server-calculated totals.
  - **Body**:
    ```json
    {
      "customer_id": "string",
      "items": [
        {
          "product_id": "string (optional)",
          "name": "string",
          "quantity": 2,
          "unit_price_centavos": 12000
        }
      ],
      "fee_centavos": 3000,
      "payment_method": "cash | exact | gcash",
      "cash_tendered_centavos": 30000,
      "payment_reference": "string (for gcash)",
      "notes": "string (optional)",
      "idempotency_key": "string (optional)"
    }
    ```
  - **Server computes**: `subtotal_centavos` (sum of items), `total_centavos` (subtotal + fee), `change_centavos`.
  - **Server assigns**: Atomic `order_number` (e.g. `1001`), initial `status: "received"`.

- `POST /api/orders/:id/actions`:
  - **Body**: `{ "action": "set_preparing" | "set_ready" | "cancel", "reason": "string" }`

### 5.2 Deliveries
- `GET /api/deliveries`:
  - If role is `admin` or `cashier`: returns all deliveries matching filters.
  - If role is `rider`: returns **only** deliveries assigned to the authenticated rider (`rider.user_id === req.user._id`).
- `POST /api/deliveries/:id/events`:
  - Transition delivery progress.
  - **Body**: `{ "event": "picked_up" | "on_the_way" | "arrived" | "report_delivered" }`
  - When `report_delivered` is sent, delivery moves to `awaiting_cashier_confirmation`.
- `POST /api/deliveries/:id/confirm`:
  - Authorized for Cashier and Admin only.
  - Transitions delivery to `completed`, updates associated order to `delivered`, closes pin on delivery map.

### 5.3 Cashier Sales Endpoint
- `POST /api/cashier/sales`:
  - Header: `Authorization: Bearer <CASHIER_API_TOKEN>`
  - Body must include a unique `transaction_id`, non-empty `items`, and valid `payment_method`.
  - Replays of identical `transaction_id` return the existing sale idempotently (`200 OK`).
  - Mismatched payloads with the same `transaction_id` return `409 Conflict`.
